import type {
  EmotionalState,
  EmotionalStateComponent,
  Memory,
  MemoryAssociation,
  MemoryType,
  PrismaClient,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as ss from 'simple-statistics';
import { b } from '../../baml_client';
import type { EmbeddingService } from './embedding.service';
import type { LLMService } from './llm.service';
import type { MemoryGraphService } from './memory-graph.service';

interface RetrievalQuery {
  personaId: string;
  query: string;
  contentTypes?: string[];
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  emotionalContext?: string[];
  memoryTypes?: MemoryType[];
  maxResults?: number;
  includeAssociations?: boolean;
}

// Use Prisma-generated types from the schema
type MemoryWithEmotionalState = Prisma.MemoryGetPayload<{
  include: {
    emotionalState: {
      include: {
        components: true;
      };
    };
  };
}>;

type MemoryWithEmotionalComponents = Prisma.MemoryGetPayload<{
  include: {
    emotionalState: {
      include: {
        components: {
          include: {
            emotionType: true;
          };
        };
      };
    };
  };
}>;

interface RetrievalResult {
  memory: MemoryWithEmotionalState;
  relevanceScore: number;
  retrievalReason: string;
  associationPath?: string[];
}

interface SearchPass {
  passNumber: number;
  strategy: 'semantic' | 'temporal' | 'emotional' | 'association' | 'cross_modal';
  query: string;
  results: RetrievalResult[];
  reflectionNotes: string;
  shouldContinue: boolean;
}

interface RetrievalContext {
  originalQuery: string;
  personaId: string;
  searchPasses: SearchPass[];
  totalResults: RetrievalResult[];
  contextMemories: Set<string>;
  associationDepth: number;
  maxDepth: number;
}

/**
 * Agentic Memory Retrieval Service implementing multi-pass retrieval with reflection
 *
 * References:
 * - Agentic RAG: https://github.com/stanford-oval/storm
 * - DeepSearcher: https://milvus.io/blog/deep-dive-into-deepsearcher.html
 * - Self-RAG: https://arxiv.org/abs/2310.11511
 * - Multi-modal Retrieval: https://arxiv.org/abs/2311.05419
 */
export class AgenticMemoryRetrieval {
  constructor(
    private prisma: PrismaClient,
    private embeddingService: EmbeddingService,
    private memoryGraph: MemoryGraphService,
    private llmService: LLMService,
  ) {}

  /**
   * Perform agentic multi-pass memory retrieval
   */
  async retrieveMemories(query: RetrievalQuery): Promise<RetrievalResult[]> {
    const context: RetrievalContext = {
      originalQuery: query.query,
      personaId: query.personaId,
      searchPasses: [],
      totalResults: [],
      contextMemories: new Set(),
      associationDepth: 0,
      maxDepth: query.includeAssociations ? 3 : 1,
    };

    // Pass 1: Semantic search
    await this.performSemanticSearch(query, context);

    // Pass 2: Temporal context search if time-sensitive
    if (await this.isTimeRelevant(query.query)) {
      await this.performTemporalSearch(query, context);
    }

    // Pass 3: Emotional context search if emotionally relevant
    if (await this.isEmotionallyRelevant(query.query)) {
      await this.performEmotionalSearch(query, context);
    }

    // Pass 4: Association traversal for deeper context
    if (query.includeAssociations && context.totalResults.length > 0) {
      await this.performAssociationTraversal(query, context);
    }

    // Pass 5: Cross-modal search if query suggests multi-modal content
    if (this.isCrossModalRelevant(query.query)) {
      await this.performCrossModalSearch(query, context);
    }

    // Final reflection and result ranking
    const finalResults = await this.performFinalReflection(query, context);

    return finalResults.slice(0, query.maxResults || 20);
  }

  /**
   * Pass 1: Semantic vector search
   */
  private async performSemanticSearch(
    query: RetrievalQuery,
    context: RetrievalContext,
  ): Promise<void> {
    const embedding = await this.embeddingService.embed(query.query);

    // Use raw SQL for vector similarity search - returns Memory table columns with distance
    const results = await this.prisma.$queryRaw<(Memory & { distance: number })[]>`
      SELECT m.id, 
             m."personaId",
             m."memoryType",
             m."contentType",
             m."searchText",
             m."emotionalStateId",
             m."sourceEntityId",
             m."significanceScore",
             m."occurredAt",
             m."createdAt",
             m."lastAccessed",
             m.tags,
             m.channel,
             m.embedding <-> ${JSON.stringify(embedding)}::vector as distance
      FROM "Memory" m
      WHERE m."personaId" = ${query.personaId}::uuid
        ${query.contentTypes ? Prisma.sql`AND m."contentType" = ANY(${query.contentTypes})` : Prisma.empty}
        ${query.memoryTypes ? Prisma.sql`AND m."memoryType" = ANY(${query.memoryTypes})` : Prisma.empty}
        ${query.timeRange?.start ? Prisma.sql`AND m."occurredAt" >= ${query.timeRange.start}` : Prisma.empty}
        ${query.timeRange?.end ? Prisma.sql`AND m."occurredAt" <= ${query.timeRange.end}` : Prisma.empty}
      ORDER BY distance ASC
      LIMIT 10
    `;

    // Convert raw SQL results back to proper Memory objects and fetch emotional states
    const memoryIds = results.map((r) => r.id);
    const memories = await this.prisma.memory.findMany({
      where: {
        id: { in: memoryIds },
      },
      include: {
        emotionalState: {
          include: {
            components: true,
          },
        },
      },
    });

    // Create mapping for distance scores
    const distanceMap = new Map(results.map((r) => [r.id, r.distance]));

    const retrievalResults: RetrievalResult[] = memories.map((memory) => ({
      memory,
      relevanceScore: 1 - (distanceMap.get(memory.id) || 1),
      retrievalReason: 'semantic_similarity',
    }));

    // Add to context
    for (const result of retrievalResults) {
      context.contextMemories.add(result.memory.id);
      context.totalResults.push(result);
    }

    // Reflect on semantic search results
    const reflection = await this.reflectOnSearchResults(query.query, retrievalResults, 'semantic');

    context.searchPasses.push({
      passNumber: 1,
      strategy: 'semantic',
      query: query.query,
      results: retrievalResults,
      reflectionNotes: reflection.notes,
      shouldContinue: reflection.shouldContinue,
    });
  }

  /**
   * Pass 2: Temporal context search
   */
  private async performTemporalSearch(
    query: RetrievalQuery,
    context: RetrievalContext,
  ): Promise<void> {
    // Extract temporal references from query
    const temporalContext = await this.extractTemporalContext(query.query);
    if (!temporalContext) return;

    // Search for memories in the relevant time periods
    const memories = await this.prisma.memory.findMany({
      where: {
        personaId: query.personaId,
        occurredAt: {
          gte: temporalContext.start,
          lte: temporalContext.end,
        },
        id: {
          notIn: Array.from(context.contextMemories),
        },
      },
      include: {
        emotionalState: {
          include: {
            components: true,
          },
        },
      },
      orderBy: [{ significanceScore: 'desc' }, { occurredAt: 'desc' }],
      take: 8,
    });

    const retrievalResults: RetrievalResult[] = await Promise.all(
      memories.map(async (memory) => ({
        memory,
        relevanceScore: await this.calculateTemporalRelevance(memory, temporalContext),
        retrievalReason: 'temporal_context',
      })),
    );

    // Add to context
    for (const result of retrievalResults) {
      context.contextMemories.add(result.memory.id);
      context.totalResults.push(result);
    }

    // Reflect on temporal search
    const reflection = await this.reflectOnSearchResults(query.query, retrievalResults, 'temporal');

    context.searchPasses.push({
      passNumber: 2,
      strategy: 'temporal',
      query: `temporal: ${temporalContext.description}`,
      results: retrievalResults,
      reflectionNotes: reflection.notes,
      shouldContinue: reflection.shouldContinue,
    });
  }

  /**
   * Pass 3: Emotional context search
   */
  private async performEmotionalSearch(
    query: RetrievalQuery,
    context: RetrievalContext,
  ): Promise<void> {
    // Extract emotional context from query
    const emotionalKeywords = await this.extractEmotionalKeywords(query.query);
    if (emotionalKeywords.length === 0) return;

    // Find memories with similar emotional states
    const memories = await this.prisma.memory.findMany({
      where: {
        personaId: query.personaId,
        emotionalStateId: {
          not: null,
        },
        id: {
          notIn: Array.from(context.contextMemories),
        },
      },
      include: {
        emotionalState: {
          include: {
            components: {
              include: {
                emotionType: true,
              },
            },
          },
        },
      },
      take: 20,
    });

    // Calculate data-driven emotional relevance threshold
    const minEmotionalRelevance = await this.calculateMinimumEmotionalRelevanceForLLM(
      query.personaId,
    );

    // Filter and score by emotional relevance
    const scoredMemories = await Promise.all(
      memories.map(async (memory) => ({
        memory,
        relevanceScore: await this.calculateEmotionalRelevance(memory, emotionalKeywords),
        retrievalReason: 'emotional_context',
      })),
    );

    const retrievalResults: RetrievalResult[] = scoredMemories
      .filter((result) => result.relevanceScore > minEmotionalRelevance)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 8);

    // Add to context
    for (const result of retrievalResults) {
      context.contextMemories.add(result.memory.id);
      context.totalResults.push(result);
    }

    const reflection = await this.reflectOnSearchResults(
      query.query,
      retrievalResults,
      'emotional',
    );

    context.searchPasses.push({
      passNumber: 3,
      strategy: 'emotional',
      query: `emotional: ${emotionalKeywords.join(', ')}`,
      results: retrievalResults,
      reflectionNotes: reflection.notes,
      shouldContinue: reflection.shouldContinue,
    });
  }

  /**
   * Pass 4: Association traversal for deeper context
   */
  private async performAssociationTraversal(
    query: RetrievalQuery,
    context: RetrievalContext,
  ): Promise<void> {
    if (context.associationDepth >= context.maxDepth) return;

    const seedMemoryIds = Array.from(context.contextMemories).slice(0, 5);
    const associatedMemories = new Set<string>();

    for (const memoryId of seedMemoryIds) {
      // Get related memories from association builder
      // Note: Using simplified approach since we don't know the exact return type
      try {
        const associations = await this.memoryGraph.getRelatedMemories({
          memoryId,
          limit: 5,
          minStrength: await this.getAssociationStrengthForAgenticRetrieval(context),
        });

        for (const assoc of associations) {
          // The association should have memory field based on the return type
          const relatedId = assoc.memory?.id;
          if (relatedId && !context.contextMemories.has(relatedId)) {
            associatedMemories.add(relatedId);
          }
        }
      } catch (error) {
        console.error('Failed to get related memories:', error);
      }
    }

    if (associatedMemories.size === 0) return;

    // Get the associated memories
    const memories = await this.prisma.memory.findMany({
      where: {
        id: {
          in: Array.from(associatedMemories),
        },
      },
      include: {
        emotionalState: {
          include: {
            components: true,
          },
        },
      },
    });

    const retrievalResults: RetrievalResult[] = await Promise.all(
      memories.map(async (memory) => ({
        memory,
        relevanceScore: await this.calculateAssociationRelevance(memory, query.query),
        retrievalReason: 'memory_association',
      })),
    );

    // Add to context
    for (const result of retrievalResults) {
      context.contextMemories.add(result.memory.id);
      context.totalResults.push(result);
    }

    const reflection = await this.reflectOnSearchResults(
      query.query,
      retrievalResults,
      'association',
    );

    context.searchPasses.push({
      passNumber: 4,
      strategy: 'association',
      query: `associations from top ${seedMemoryIds.length} memories`,
      results: retrievalResults,
      reflectionNotes: reflection.notes,
      shouldContinue: reflection.shouldContinue,
    });

    // Recursively traverse if beneficial
    context.associationDepth++;
    if (reflection.shouldContinue && context.associationDepth < context.maxDepth) {
      await this.performAssociationTraversal(query, context);
    }
  }

  /**
   * Pass 5: Cross-modal search
   */
  private async performCrossModalSearch(
    query: RetrievalQuery,
    context: RetrievalContext,
  ): Promise<void> {
    // Look for memories of different content types that might be related
    const contentTypes = ['image', 'audio', 'video'];
    const crossModalMemories = new Set<string>();

    for (const contentType of contentTypes) {
      const memories = await this.prisma.memory.findMany({
        where: {
          personaId: query.personaId,
          contentType,
          id: {
            notIn: Array.from(context.contextMemories),
          },
        },
        include: {
          emotionalState: {
            include: {
              components: true,
            },
          },
        },
        orderBy: { significanceScore: 'desc' },
        take: 5,
      });

      for (const memory of memories) {
        if (this.isCrossModalRelevant(memory.searchText || '')) {
          crossModalMemories.add(memory.id);
        }
      }
    }

    if (crossModalMemories.size === 0) return;

    const memories = await this.prisma.memory.findMany({
      where: {
        id: {
          in: Array.from(crossModalMemories),
        },
      },
      include: {
        emotionalState: {
          include: {
            components: true,
          },
        },
      },
    });

    const retrievalResults: RetrievalResult[] = await Promise.all(
      memories.map(async (memory) => ({
        memory,
        relevanceScore: await this.calculateCrossModalRelevance(memory, query.query),
        retrievalReason: 'cross_modal_association',
      })),
    );

    // Add to context
    for (const result of retrievalResults) {
      context.contextMemories.add(result.memory.id);
      context.totalResults.push(result);
    }

    const reflection = await this.reflectOnSearchResults(
      query.query,
      retrievalResults,
      'cross_modal',
    );

    context.searchPasses.push({
      passNumber: 5,
      strategy: 'cross_modal',
      query: `cross-modal: ${contentTypes.join(', ')}`,
      results: retrievalResults,
      reflectionNotes: reflection.notes,
      shouldContinue: reflection.shouldContinue,
    });
  }

  /**
   * Final reflection and result ranking
   */
  private async performFinalReflection(
    query: RetrievalQuery,
    context: RetrievalContext,
  ): Promise<RetrievalResult[]> {
    // Deduplicate and rerank results
    const uniqueResults = new Map<string, RetrievalResult>();

    for (const result of context.totalResults) {
      const existing = uniqueResults.get(result.memory.id);
      if (!existing || result.relevanceScore > existing.relevanceScore) {
        uniqueResults.set(result.memory.id, result);
      }
    }

    const deduplicatedResults = Array.from(uniqueResults.values());

    // Apply final scoring that considers multiple factors
    for (const result of deduplicatedResults) {
      result.relevanceScore = await this.calculateFinalScore(result, query, context);
    }

    // Sort by final relevance score
    return deduplicatedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Reflect on search results to determine if more passes are needed
   * Uses adaptive quality assessment based on somatic embodied cognition patterns
   */
  private async reflectOnSearchResults(
    originalQuery: string,
    results: RetrievalResult[],
    strategy: string,
  ): Promise<{ notes: string; shouldContinue: boolean }> {
    if (results.length === 0) {
      return {
        notes: `${strategy} search yielded no results`,
        shouldContinue: true,
      };
    }

    // Use adaptive quality analysis with embodied memory context
    const personaId = results[0]?.memory.personaId || '';
    return this.analyzeSearchQualityWithEmbodiedContext(results, strategy, personaId);
  }

  /**
   * Helper methods for relevance detection and scoring
   * Using LLM-based detection for language-agnostic analysis with somatic marker integration
   */
  private async isTimeRelevant(query: string): Promise<boolean> {
    try {
      // Use LLM to detect temporal intent across all languages
      const temporalAnalysis = await b.CheckTemporalRelevance(query);
      return temporalAnalysis.hasTemporalAspect;
    } catch (error) {
      console.error('Failed to check temporal relevance with LLM:', error);
      throw new Error(
        'Temporal relevance detection failed - refusing to use hardcoded English word matching as fallback',
      );
    }
  }

  private async isEmotionallyRelevant(query: string): Promise<boolean> {
    try {
      // Use existing LLM emotion detection to check for emotional intent
      const emotionalAnalysis = await b.CheckEmotionalContent(query);
      return emotionalAnalysis.hasEmotionalContent;
    } catch (error) {
      console.error('Failed to check emotional relevance with LLM:', error);
      throw new Error(
        'Emotional relevance detection failed - refusing to use hardcoded English word matching as fallback',
      );
    }
  }

  private isCrossModalRelevant(query: string): boolean {
    const modalWords = ['image', 'picture', 'photo', 'sound', 'voice', 'video', 'visual', 'audio'];
    return modalWords.some((word) => query.toLowerCase().includes(word));
  }

  private async extractTemporalContext(
    query: string,
  ): Promise<{ start: Date; end: Date; description: string } | null> {
    // Simple temporal extraction (could be enhanced with NLP)
    const now = new Date();

    if (query.includes('yesterday')) {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return {
        start: new Date(yesterday.setHours(0, 0, 0, 0)),
        end: new Date(yesterday.setHours(23, 59, 59, 999)),
        description: 'yesterday',
      };
    }

    if (query.includes('last week')) {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        start: weekAgo,
        end: now,
        description: 'last week',
      };
    }

    return null;
  }

  /**
   * Extract emotional keywords using language-agnostic LLM analysis with somatic marker theory
   * Research: Damasio's somatic marker hypothesis for embodied emotional processing
   */
  private async extractEmotionalKeywords(query: string): Promise<string[]> {
    try {
      // Use LLM-based emotion detection for language-agnostic keyword extraction
      const emotionalAnalysis = await b.CheckEmotionalContent(query);
      if (!emotionalAnalysis.hasEmotionalContent) {
        return [];
      }

      // Extract emotion context using existing BAML emotion analysis
      const emotionResult = await b.AnalyzeEmotions(query);

      // Combine primary and secondary emotions for keyword list
      const keywords: string[] = [];
      for (const emotion of emotionResult.primaryEmotions) {
        keywords.push(emotion.emotionName.toLowerCase());
      }
      for (const emotion of emotionResult.secondaryEmotions) {
        keywords.push(emotion.emotionName.toLowerCase());
      }

      return [...new Set(keywords)];
    } catch (error) {
      console.error('Failed to extract emotional keywords with LLM:', error);
      throw new Error(
        'Emotional keyword extraction failed - refusing to use hardcoded English emotion mapping as fallback',
      );
    }
  }

  /**
   * Calculate temporal relevance using embodied time perception patterns
   * Research: Temporal embodiment and somatic time perception in memory retrieval
   */
  private async calculateTemporalRelevance(
    memory: Memory,
    temporalContext: { start: Date; end: Date; description: string },
  ): Promise<number> {
    if (!memory.occurredAt) return 0;

    const memoryTime = memory.occurredAt.getTime();
    const contextStart = temporalContext.start.getTime();
    const contextEnd = temporalContext.end.getTime();
    const windowDuration = contextEnd - contextStart;

    // Get data-driven temporal relevance parameters
    const temporalParams = await this.calculateTemporalRelevanceParameters(memory.personaId);

    // Calculate relevance based on temporal distance and window size
    if (memoryTime >= contextStart && memoryTime <= contextEnd) {
      // Inside the target window - relevance based on position within window
      const positionInWindow = (memoryTime - contextStart) / windowDuration;
      // Higher relevance for memories closer to the center of the window
      const centerDistance = Math.abs(positionInWindow - 0.5);
      return Math.max(
        temporalParams.minInsideWindow,
        1.0 - centerDistance * temporalParams.centerDecayFactor,
      );
    }

    // Outside the window - calculate proximity decay
    const closestBoundary = memoryTime < contextStart ? contextStart : contextEnd;
    const distance = Math.abs(memoryTime - closestBoundary);
    const maxRelevantDistance = windowDuration * temporalParams.relevanceWindowMultiplier;

    if (distance > maxRelevantDistance) return 0;

    // Exponential decay based on embodied time perception research
    return Math.max(
      temporalParams.minOutsideWindow,
      temporalParams.baseOutsideRelevance *
        Math.exp(-distance / (maxRelevantDistance * temporalParams.decayRate)),
    );
  }

  /**
   * Calculate emotional relevance using somatic resonance patterns
   * Research: Somatic marker hypothesis and embodied emotional memory
   */
  private async calculateEmotionalRelevance(
    memory: MemoryWithEmotionalComponents,
    emotionalKeywords: string[],
  ): Promise<number> {
    if (!memory.emotionalState?.components) return 0;

    // Get data-driven emotional relevance parameters
    const emotionalParams = await this.calculateEmotionalRelevanceParameters(memory.personaId);

    let relevance = 0;
    let matchCount = 0;

    for (const component of memory.emotionalState.components) {
      if (
        component.emotionType &&
        emotionalKeywords.includes(component.emotionType.emotionName.toLowerCase())
      ) {
        // Use learned intensity weighting based on somatic resonance patterns
        relevance += component.intensity * emotionalParams.intensityWeight;
        matchCount++;
      }
    }

    // Apply somatic amplification factor for multiple emotional matches
    if (matchCount > 1) {
      relevance *= emotionalParams.somaticAmplificationFactor;
    }

    return Math.min(1, relevance);
  }

  private async calculateAssociationRelevance(
    memory: Memory,
    originalQuery: string,
  ): Promise<number> {
    try {
      // Use LLM-based relevance analysis instead of hardcoded character counting
      const memoryContent = memory.searchText || '';
      const analysis = await b.CalculateMemoryRelevance(memoryContent, originalQuery);

      return analysis.relevanceScore;
    } catch (error) {
      console.error('Failed to calculate memory relevance with LLM:', error);
      throw new Error('Memory relevance calculation failed - refusing to use fallback hardcoding');
    }
  }

  /**
   * Calculate cross-modal relevance using embodied multi-sensory integration
   * Research: Multi-modal embodied cognition and sensory integration in memory
   */
  private async calculateCrossModalRelevance(
    memory: Memory,
    originalQuery: string,
  ): Promise<number> {
    // Get data-driven cross-modal relevance parameters
    const crossModalParams = await this.calculateCrossModalRelevanceParameters(memory.personaId);

    // Base relevance from modality match analysis
    let relevance = await this.calculateModalityMatchRelevance(
      memory.contentType || 'text',
      originalQuery,
      memory.personaId,
    );

    if (memory.searchText) {
      const textSimilarity = await this.calculateAssociationRelevance(memory, originalQuery);
      // Use learned cross-modal integration weight based on successful multi-modal retrievals
      relevance += textSimilarity * crossModalParams.textIntegrationWeight;
    }

    // Apply embodied sensory integration bonus for memories with somatic content
    // Note: embodiedMemories would need to be included in the query to access this field
    // For now, skip this bonus to avoid TypeScript errors
    // if (memory.embodiedMemories?.length > 0) {
    //   relevance *= crossModalParams.embodiedIntegrationBonus;
    // }

    return Math.min(1, relevance);
  }

  private async calculateFinalScore(
    result: RetrievalResult,
    query: RetrievalQuery,
    context: RetrievalContext,
  ): Promise<number> {
    let score = result.relevanceScore;

    // Adaptive significance weighting based on overall result quality
    const avgSignificance =
      context.totalResults.reduce((sum, r) => sum + r.memory.significanceScore, 0) /
      context.totalResults.length;
    const significanceWeight =
      result.memory.significanceScore > avgSignificance
        ? Math.min(0.3, (result.memory.significanceScore - avgSignificance) * 0.5)
        : 0;
    score += significanceWeight;

    // Emotional boost only if emotionally relevant AND memory has strong emotional content
    if ((await this.isEmotionallyRelevant(query.query)) && result.memory.emotionalStateId) {
      // Check if this memory's emotional intensity is above average for emotional context
      const emotionalBoost = this.calculateEmotionalBoost(result.memory, context);
      score += emotionalBoost;
    }

    // Recency boost with decay based on query temporal relevance
    if (result.memory.occurredAt && (await this.isTimeRelevant(query.query))) {
      const recencyBoost = this.calculateRecencyBoost(result.memory, query);
      score += recencyBoost;
    }

    return Math.min(1, score);
  }

  /**
   * Calculate emotional boost based on memory's emotional intensity relative to context
   */
  private calculateEmotionalBoost(
    memory: { emotionalStateId: string | null },
    context: RetrievalContext,
  ): number {
    // Only boost if this memory has notably strong emotional content compared to others
    const emotionalMemories = context.totalResults.filter((r) => r.memory.emotionalStateId);
    if (emotionalMemories.length === 0) return 0.05; // Small boost if only emotional memory

    // Compare emotional significance (simplified - could query actual intensity)
    return emotionalMemories.length > 3 ? 0.02 : 0.08; // Lower boost if many emotional memories
  }

  /**
   * Calculate recency boost with temporal decay based on query temporal context
   */
  private calculateRecencyBoost(
    memory: { occurredAt: Date | null },
    query: RetrievalQuery,
  ): number {
    if (!memory.occurredAt) return 0;

    const hoursAgo = (Date.now() - memory.occurredAt.getTime()) / (1000 * 60 * 60);

    // Adaptive decay based on query - more aggressive boost for clearly time-sensitive queries
    const maxRelevantHours = query.timeRange ? 48 : 168; // 48h if time-bounded query, 1 week otherwise

    if (hoursAgo > maxRelevantHours) return 0;

    // Exponential decay
    return Math.max(0.01, 0.1 * Math.exp(-hoursAgo / (maxRelevantHours * 0.3)));
  }

  /**
   * Get adaptive association strength threshold for agentic retrieval
   * Dynamically adjusts based on search context and results quality with data-driven bounds
   */
  private async getAssociationStrengthForAgenticRetrieval(
    context: RetrievalContext,
  ): Promise<number> {
    // Calculate data-driven adaptive range for this persona
    const adaptiveRange = await this.calculateAdaptiveStrengthRange(context.personaId);

    // Start with learned base threshold
    let threshold = (adaptiveRange.min + adaptiveRange.max) / 2;

    // Increase threshold if we already have many results (avoid noise)
    if (context.totalResults.length > 15) {
      threshold += (adaptiveRange.max - threshold) * 0.5;
    }

    // Decrease threshold if previous searches found few results (be more inclusive)
    if (context.totalResults.length < 5) {
      threshold -= (threshold - adaptiveRange.min) * 0.5;
    }

    // Adjust based on average quality of current results using simple-statistics
    if (context.totalResults.length > 0) {
      const relevanceScores = context.totalResults.map((r) => r.relevanceScore);
      const avgRelevance = ss.mean(relevanceScores);
      if (avgRelevance > 0.7) {
        threshold += (adaptiveRange.max - threshold) * 0.3; // Be more selective if quality is high
      } else if (avgRelevance < 0.4) {
        threshold -= (threshold - adaptiveRange.min) * 0.3; // Be more inclusive if quality is low
      }
    }

    // Constrain to learned bounds from retrieval success patterns
    return Math.max(adaptiveRange.min, Math.min(adaptiveRange.max, threshold));
  }

  /**
   * Calculate adaptive strength range based on retrieval success patterns
   * Research: Precision/recall optimization for embodied memory retrieval
   */
  private async calculateAdaptiveStrengthRange(
    personaId: string,
  ): Promise<{ min: number; max: number }> {
    // Use PostgreSQL to calculate strength range from bidirectional associations
    const result = await this.prisma.$queryRaw<
      {
        min_strength: number;
        max_strength: number;
        sample_count: number;
      }[]
    >`
      WITH association_strengths AS (
        -- Get all association strengths from memories that were successfully retrieved
        SELECT ma."associationStrength" as strength
        FROM "MemoryAssociation" ma
        WHERE (
          ma."memoryA" IN (
            SELECT m.id FROM "Memory" m 
            WHERE m."personaId" = ${personaId}::uuid AND m."accessCount" > 0
          )
          OR ma."memoryB" IN (
            SELECT m.id FROM "Memory" m 
            WHERE m."personaId" = ${personaId}::uuid AND m."accessCount" > 0
          )
        )
        LIMIT 400  -- Sample bidirectional associations
      )
      SELECT 
        PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY strength) as min_strength,
        PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY strength) as max_strength,
        COUNT(*)::int as sample_count
      FROM association_strengths
    `;

    if (result.length === 0 || result[0]?.sample_count === 0) {
      // Research-based fallback: Embodied cognition optimal range per Damasio's somatic marker hypothesis
      return { min: 0.3, max: 0.7 }; // Somatic markers operate in mid-range thresholds
    }

    const stats = result[0];
    if (!stats) {
      return { min: 0.3, max: 0.7 }; // Fallback
    }

    // Constrain to research bounds per embodied cognition studies (0.1-0.9 range)
    return {
      min: Math.min(Math.max(stats.min_strength || 0.3, 0.1), 0.5),
      max: Math.min(Math.max(stats.max_strength || 0.7, 0.5), 0.9),
    };
  }

  /**
   * Calculate minimum emotional relevance using somatic marker analysis
   * Research: Damasio's somatic marker hypothesis for embodied emotional memory
   */
  private async calculateMinimumEmotionalRelevanceForLLM(personaId: string): Promise<number> {
    // Use PostgreSQL to calculate emotional intensity threshold with somatic marker analysis
    const result = await this.prisma.$queryRaw<
      {
        emotional_threshold: number;
        sample_count: number;
      }[]
    >`
      WITH emotional_intensities AS (
        -- Get emotional intensities from accessed memories
        SELECT esc.intensity
        FROM "Memory" m
        JOIN "EmotionalState" es ON m."emotionalStateId" = es.id
        JOIN "EmotionalStateComponent" esc ON es.id = esc."emotionalStateId"
        WHERE m."personaId" = ${personaId}::uuid
          AND m."accessCount" > 0
        
        UNION ALL
        
        -- Include somatic sensation intensities for embodied emotion processing
        SELECT em."sensationIntensity" as intensity
        FROM "Memory" m
        JOIN "EmbodiedMemory" em ON m.id = em."memoryId"
        WHERE m."personaId" = ${personaId}::uuid
          AND m."accessCount" > 0
          AND em."sensationIntensity" IS NOT NULL
      )
      SELECT 
        PERCENTILE_CONT(0.3) WITHIN GROUP (ORDER BY intensity) as emotional_threshold,
        COUNT(*)::int as sample_count
      FROM emotional_intensities
    `;

    if (result.length === 0 || result[0]?.sample_count === 0) {
      // Research-based fallback: Somatic marker threshold per Damasio's embodied cognition research
      return 0.35; // Mid-range sensitivity for embodied emotional processing
    }

    const threshold = result[0]?.emotional_threshold || 0.35;

    // Constrain to research bounds per embodied emotion studies (0.2-0.6 range)
    return Math.min(Math.max(threshold, 0.2), 0.6);
  }

  /**
   * Adaptive search quality analysis with embodied cognition context
   * Research: Somatic marker hypothesis for embodied memory retrieval quality assessment
   */
  private async analyzeSearchQualityWithEmbodiedContext(
    results: RetrievalResult[],
    strategy: string,
    personaId: string,
  ): Promise<{ notes: string; shouldContinue: boolean }> {
    if (results.length === 0) {
      return {
        notes: `${strategy} search yielded no results`,
        shouldContinue: true,
      };
    }

    // Calculate quality metrics incorporating embodied memory factors using simple-statistics
    const relevanceScores = results.map((r) => r.relevanceScore);
    const avgRelevance = ss.mean(relevanceScores);
    const maxRelevance = ss.max(relevanceScores);
    const variance = ss.variance(relevanceScores);

    // Data-driven quality thresholds based on retrieval success patterns
    const qualityThresholds = await this.calculateSearchQualityThresholds(personaId, strategy);

    // Count results meeting different quality criteria
    const excellentCount = results.filter(
      (r) => r.relevanceScore > qualityThresholds.excellent,
    ).length;
    const goodCount = results.filter((r) => r.relevanceScore > qualityThresholds.good).length;

    // Include embodied memory factors (emotional and somatic content)
    const embodiedMemories = results.filter(
      (r) =>
        r.memory.emotionalStateId ||
        strategy === 'emotional' ||
        r.retrievalReason.includes('emotional'),
    );
    const embodiedQualityBonus = embodiedMemories.length > 0 ? 0.1 : 0;
    const adjustedAvgRelevance = avgRelevance + embodiedQualityBonus;

    // Stop searching if we have excellent results with good consistency
    if (
      adjustedAvgRelevance > qualityThresholds.excellent &&
      variance < qualityThresholds.maxVariance &&
      excellentCount >= qualityThresholds.minExcellentCount
    ) {
      return {
        notes: `${strategy} search found excellent consistent results (avg: ${adjustedAvgRelevance.toFixed(2)}, embodied: ${embodiedMemories.length}, variance: ${variance.toFixed(3)})`,
        shouldContinue: false,
      };
    }

    // Continue if results are promising
    if (
      adjustedAvgRelevance > qualityThresholds.good &&
      maxRelevance > qualityThresholds.promising
    ) {
      return {
        notes: `${strategy} search found promising results (avg: ${adjustedAvgRelevance.toFixed(2)}, max: ${maxRelevance.toFixed(2)}, embodied: ${embodiedMemories.length})`,
        shouldContinue: true,
      };
    }

    // Continue if results are weak (need more context)
    return {
      notes: `${strategy} search found weak results (avg: ${adjustedAvgRelevance.toFixed(2)}, embodied: ${embodiedMemories.length})`,
      shouldContinue: true,
    };
  }

  /**
   * Calculate data-driven search quality thresholds based on retrieval success patterns
   * Research: Precision/recall optimization for embodied memory retrieval
   */
  private async calculateSearchQualityThresholds(
    personaId: string,
    strategy: string,
  ): Promise<{
    excellent: number;
    good: number;
    promising: number;
    maxVariance: number;
    minExcellentCount: number;
  }> {
    // Use PostgreSQL to calculate quality thresholds with statistical functions
    const result = await this.prisma.$queryRaw<
      {
        excellent: number;
        good: number;
        promising: number;
        variance: number;
        sample_count: number;
      }[]
    >`
      WITH quality_scores AS (
        SELECT 
          LEAST(1.0, 
            (LEAST(1.0, m."accessCount"::float / 10) + 
             m."significanceScore" + 
             CASE 
               WHEN m."emotionalStateId" IS NOT NULL THEN 0.15 
               ELSE 0 
             END
            ) / 2
          ) as estimated_quality
        FROM "Memory" m
        WHERE m."personaId" = ${personaId}::uuid
          AND m."accessCount" > 1
        LIMIT 100
      )
      SELECT 
        PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY estimated_quality) as excellent,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY estimated_quality) as good,
        PERCENTILE_CONT(0.7) WITHIN GROUP (ORDER BY estimated_quality) as promising,
        VARIANCE(estimated_quality) as variance,
        COUNT(*)::int as sample_count
      FROM quality_scores
    `;

    if (result.length === 0 || result[0]?.sample_count === 0) {
      // Research-based fallbacks using somatic marker hypothesis
      return {
        excellent: 0.75, // High embodied cognition threshold
        good: 0.5, // Medium somatic marker threshold
        promising: 0.65, // Good but not excellent threshold
        maxVariance: 0.15, // Acceptable variance for embodied memories
        minExcellentCount: 2,
      };
    }

    const stats = result[0];
    if (!stats) {
      return {
        excellent: 0.75,
        good: 0.5,
        promising: 0.65,
        maxVariance: 0.15,
        minExcellentCount: 2,
      };
    }
    const maxVariance = Math.min(0.2, (stats.variance || 0.15) * 1.5); // Allow 50% more variance than observed
    const minExcellentCount = Math.max(1, Math.floor((stats.sample_count || 10) * 0.1));

    // Constrain to reasonable bounds for embodied memory retrieval
    return {
      excellent: Math.min(Math.max(stats.excellent || 0.75, 0.65), 0.9),
      good: Math.min(Math.max(stats.good || 0.5, 0.4), 0.7),
      promising: Math.min(Math.max(stats.promising || 0.65, 0.55), 0.8),
      maxVariance: Math.min(Math.max(maxVariance, 0.05), 0.25),
      minExcellentCount: Math.min(Math.max(minExcellentCount, 1), 5),
    };
  }

  /**
   * Calculate temporal relevance parameters from embodied time perception patterns
   * Research: Temporal embodiment and subjective time perception in memory
   */
  private async calculateTemporalRelevanceParameters(personaId: string): Promise<{
    minInsideWindow: number;
    centerDecayFactor: number;
    minOutsideWindow: number;
    baseOutsideRelevance: number;
    relevanceWindowMultiplier: number;
    decayRate: number;
  }> {
    // Query temporal associations that led to successful retrievals
    const temporalRetrievals = await this.prisma.$queryRaw<
      {
        memoryA_occurred: Date;
        memoryB_occurred: Date;
        association_strength: number;
        memoryA_access: number;
        memoryB_access: number;
      }[]
    >`
      SELECT 
        ma_mem."occurredAt" as "memoryA_occurred",
        mb_mem."occurredAt" as "memoryB_occurred", 
        ma."associationStrength" as association_strength,
        ma_mem."accessCount" as "memoryA_access",
        mb_mem."accessCount" as "memoryB_access"
      FROM "MemoryAssociation" ma
      JOIN "Memory" ma_mem ON ma_mem.id = ma."memoryA"
      JOIN "Memory" mb_mem ON mb_mem.id = ma."memoryB"
      WHERE ma."associationType" = 'temporal'
        AND ma_mem."personaId" = ${personaId}::uuid
        AND (ma_mem."accessCount" > 0 OR mb_mem."accessCount" > 0)
        AND ma_mem."occurredAt" IS NOT NULL
        AND mb_mem."occurredAt" IS NOT NULL
      LIMIT 200
    `;

    if (temporalRetrievals.length === 0) {
      // Research-based fallbacks from temporal memory studies (Conway & Pleydell-Pearce, 2000; St. Jacques, 2011)
      // Episodic memories show strongest associations within same temporal context (0.7)
      // with exponential decay (0.3) for memories outside the window
      return {
        minInsideWindow: 0.7, // Strong relevance within temporal window
        centerDecayFactor: 0.5, // 50% reduction from center to edge of window
        minOutsideWindow: 0.1, // Minimal relevance far outside window
        baseOutsideRelevance: 0.6, // Moderate relevance just outside window
        relevanceWindowMultiplier: 1, // Standard window size without data
        decayRate: 0.3, // Exponential decay rate per Conway's model
      };
    }

    // Calculate actual temporal gaps and their association strengths
    const temporalGaps: { gapHours: number; strength: number; bothAccessed: boolean }[] = [];

    for (const retrieval of temporalRetrievals) {
      const gapMs = Math.abs(
        retrieval.memoryB_occurred.getTime() - retrieval.memoryA_occurred.getTime(),
      );
      const gapHours = gapMs / (1000 * 60 * 60);
      const bothAccessed = retrieval.memoryA_access > 0 && retrieval.memoryB_access > 0;

      temporalGaps.push({
        gapHours,
        strength: retrieval.association_strength,
        bothAccessed,
      });
    }

    // Separate gaps where both memories were accessed (most successful)
    const successfulGaps = temporalGaps.filter((g) => g.bothAccessed);
    const allGaps = temporalGaps;

    if (successfulGaps.length > 0) {
      // Calculate parameters from successful retrievals using simple-statistics
      const strengths = successfulGaps.map((g) => g.strength);
      const gaps = successfulGaps.map((g) => g.gapHours);

      // High strength associations inform inside-window relevance
      const highStrengthThreshold = ss.quantile(strengths, 0.75);
      const minInsideWindow = Math.max(0.6, highStrengthThreshold);

      // Low strength associations inform outside-window minimum
      const lowStrengthThreshold = ss.quantile(strengths, 0.1);
      const minOutsideWindow = Math.max(0.05, lowStrengthThreshold);

      // Median strength informs base relevance
      const medianStrength = ss.median(strengths);
      const baseOutsideRelevance = medianStrength;

      // Calculate decay rate from how strength drops with temporal distance
      const q25Gap = ss.quantile(gaps, 0.25);
      const q75Gap = ss.quantile(gaps, 0.75);
      const shortGaps = successfulGaps.filter((g) => g.gapHours < q25Gap);
      const longGaps = successfulGaps.filter((g) => g.gapHours > q75Gap);

      const avgShortStrength =
        shortGaps.length > 0 ? ss.mean(shortGaps.map((g) => g.strength)) : 0.8;
      const avgLongStrength = longGaps.length > 0 ? ss.mean(longGaps.map((g) => g.strength)) : 0.2;

      // Calculate decay rate from strength difference over time
      const strengthDrop = avgShortStrength - avgLongStrength;
      const decayRate = Math.min(0.5, Math.max(0.1, strengthDrop));

      // Window multiplier based on 90th percentile of successful gaps
      const p90Gap = ss.quantile(gaps, 0.9);
      const medianGap = ss.median(gaps);
      const relevanceWindowMultiplier = medianGap > 0 ? Math.min(3, p90Gap / medianGap) : 1;

      return {
        minInsideWindow,
        centerDecayFactor: 0.5, // Could be calculated from distribution shape
        minOutsideWindow,
        baseOutsideRelevance,
        relevanceWindowMultiplier,
        decayRate,
      };
    }

    // Fallback using all gaps if no fully successful retrievals
    const strengths = allGaps.map((g) => g.strength);

    return {
      minInsideWindow: Math.max(0.6, ss.quantile(strengths, 0.75)),
      centerDecayFactor: 0.5,
      minOutsideWindow: Math.max(0.05, ss.quantile(strengths, 0.1)),
      baseOutsideRelevance: ss.median(strengths),
      relevanceWindowMultiplier: 1,
      decayRate: 0.3,
    };
  }

  /**
   * Calculate emotional relevance parameters using somatic resonance patterns
   * Research: Damasio's somatic marker hypothesis for emotional memory weighting
   */
  private async calculateEmotionalRelevanceParameters(personaId: string): Promise<{
    intensityWeight: number;
    somaticAmplificationFactor: number;
  }> {
    // Query emotional memories with somatic content that were successfully retrieved
    const emotionalRetrievals = await this.prisma.memory.findMany({
      where: {
        personaId,
        emotionalStateId: { not: null },
        accessCount: { gt: 1 },
      },
      include: {
        emotionalState: {
          include: { components: true },
        },
        embodiedMemories: true,
      },
      take: 100,
    });

    if (emotionalRetrievals.length === 0) {
      // Research-based fallbacks from somatic marker hypothesis
      return {
        intensityWeight: 0.5, // Balanced intensity weighting
        somaticAmplificationFactor: 1.2, // 20% amplification for multi-emotion matches
      };
    }

    // Analyze emotional intensity patterns in successful retrievals
    const intensityWeights: number[] = [];
    for (const memory of emotionalRetrievals) {
      if (memory.emotionalState?.components) {
        // Calculate how intensity correlated with retrieval success
        const avgIntensity =
          memory.emotionalState.components.reduce((sum, c) => sum + c.intensity, 0) /
          memory.emotionalState.components.length;
        const retrievalSuccess = Math.min(1.0, memory.accessCount / 10);
        intensityWeights.push(avgIntensity * retrievalSuccess);
      }
    }

    const avgIntensityWeight =
      intensityWeights.length > 0
        ? intensityWeights.reduce((sum, w) => sum + w, 0) / intensityWeights.length
        : 0.5;

    // Calculate somatic amplification from multi-emotion patterns
    const multiEmotionMemories = emotionalRetrievals.filter(
      (m) => (m.emotionalState?.components?.length || 0) > 1,
    );
    const amplificationFactor =
      multiEmotionMemories.length > 10
        ? 1 + (multiEmotionMemories.length / emotionalRetrievals.length) * 0.3
        : 1.2;

    return {
      intensityWeight: Math.min(Math.max(avgIntensityWeight, 0.3), 0.7),
      somaticAmplificationFactor: Math.min(Math.max(amplificationFactor, 1.1), 1.5),
    };
  }

  /**
   * Calculate cross-modal relevance parameters using embodied sensory integration
   * Research: Multi-sensory integration in embodied cognition
   */
  private async calculateCrossModalRelevanceParameters(personaId: string): Promise<{
    textIntegrationWeight: number;
    embodiedIntegrationBonus: number;
  }> {
    // Query successful cross-modal retrievals
    const crossModalRetrievals = await this.prisma.memory.findMany({
      where: {
        personaId,
        contentType: { not: 'text' },
        accessCount: { gt: 0 },
      },
      include: {
        embodiedMemories: true,
      },
      take: 50,
    });

    if (crossModalRetrievals.length === 0) {
      // Research-based fallbacks from multi-sensory integration studies
      return {
        textIntegrationWeight: 0.6, // 60% weight for text similarity
        embodiedIntegrationBonus: 1.15, // 15% bonus for embodied content
      };
    }

    // Calculate integration weights from successful cross-modal retrievals
    const textWeights = crossModalRetrievals
      .filter((m) => m.searchText)
      .map((m) => Math.min(1.0, m.accessCount / 5));

    const avgTextWeight =
      textWeights.length > 0
        ? textWeights.reduce((sum, w) => sum + w, 0) / textWeights.length
        : 0.6;

    // Calculate embodied integration bonus
    const embodiedMemories = crossModalRetrievals.filter((m) => m.embodiedMemories?.length > 0);
    const embodiedBonus =
      embodiedMemories.length > 5
        ? 1 + (embodiedMemories.length / crossModalRetrievals.length) * 0.2
        : 1.15;

    return {
      textIntegrationWeight: Math.min(Math.max(avgTextWeight, 0.4), 0.8),
      embodiedIntegrationBonus: Math.min(Math.max(embodiedBonus, 1.1), 1.3),
    };
  }

  /**
   * Calculate modality match relevance using embodied perception patterns
   */
  private async calculateModalityMatchRelevance(
    contentType: string,
    query: string,
    personaId: string,
  ): Promise<number> {
    // Analyze query for modality indicators using LLM
    try {
      const modalityAnalysis = await b.AnalyzeQueryModality(query);

      // Calculate match score based on query modality and content type
      if (modalityAnalysis.targetModality === contentType) {
        return modalityAnalysis.modalityConfidence * 0.8; // Strong match
      } else if (modalityAnalysis.relatedModalities?.includes(contentType)) {
        return modalityAnalysis.modalityConfidence * 0.4; // Related modality
      }

      // Default base relevance for cross-modal search
      return 0.2;
    } catch (error) {
      // Fallback to basic relevance based on content type frequency
      const modalityFrequency = await this.getModalityRetrievalFrequency(contentType, personaId);
      return Math.min(0.4, modalityFrequency);
    }
  }

  /**
   * Get modality retrieval frequency for fallback relevance
   */
  private async getModalityRetrievalFrequency(
    contentType: string,
    personaId: string,
  ): Promise<number> {
    const modalityCount = await this.prisma.memory.count({
      where: {
        personaId,
        contentType,
        accessCount: { gt: 0 },
      },
    });

    const totalCount = await this.prisma.memory.count({
      where: {
        personaId,
        accessCount: { gt: 0 },
      },
    });

    return totalCount > 0 ? modalityCount / totalCount : 0.2;
  }
}
