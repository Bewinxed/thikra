import type {
  EmotionalState,
  EmotionalStateComponent,
  Memory,
  MemoryAssociation,
  MemoryType,
  PrismaClient,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
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
    if (this.isTimeRelevant(query.query)) {
      await this.performTemporalSearch(query, context);
    }

    // Pass 3: Emotional context search if emotionally relevant
    if (this.isEmotionallyRelevant(query.query)) {
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

    const retrievalResults: RetrievalResult[] = memories.map((memory) => ({
      memory,
      relevanceScore: this.calculateTemporalRelevance(memory, temporalContext),
      retrievalReason: 'temporal_context',
    }));

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

    // Filter and score by emotional relevance
    const retrievalResults: RetrievalResult[] = memories
      .map((memory) => ({
        memory,
        relevanceScore: this.calculateEmotionalRelevance(memory, emotionalKeywords),
        retrievalReason: 'emotional_context',
      }))
      .filter((result) => result.relevanceScore > this.getMinimumEmotionalRelevanceForLLM())
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
          minStrength: this.getAssociationStrengthForAgenticRetrieval(context),
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
      }))
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
      }))
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

    // Use adaptive quality analysis instead of hardcoded thresholds
    return this.analyzeSearchQuality(results, strategy);
  }

  /**
   * Helper methods for relevance detection and scoring
   * Using LLM-based detection for language-agnostic analysis
   */
  private async isTimeRelevant(query: string): Promise<boolean> {
    try {
      // Use LLM to detect temporal intent across all languages
      const temporalAnalysis = await b.CheckTemporalRelevance(query);
      return temporalAnalysis.hasTemporalAspect;
    } catch (error) {
      console.error('Failed to check temporal relevance with LLM:', error);
      // Fallback: assume temporal relevance if query seems to reference time concepts
      return /\b(time|when|day|hour|recent|past|future|now|then)\b/i.test(query);
    }
  }

  private async isEmotionallyRelevant(query: string): Promise<boolean> {
    try {
      // Use existing LLM emotion detection to check for emotional intent
      const emotionalAnalysis = await b.CheckEmotionalContent(query);
      return emotionalAnalysis.hasEmotionalContent;
    } catch (error) {
      console.error('Failed to check emotional relevance with LLM:', error);
      // Fallback: assume emotional relevance if query seems to reference emotions
      return /\b(feel|emotion|mood|love|hate|happy|sad|angry|excited|afraid)\b/i.test(query);
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

  private async extractEmotionalKeywords(query: string): Promise<string[]> {
    const emotionMap = {
      happy: ['joy', 'happiness'],
      sad: ['sadness'],
      angry: ['anger'],
      scared: ['fear'],
      excited: ['excitement', 'anticipation'],
      love: ['love', 'affection'],
    };

    const keywords: string[] = [];
    for (const [key, emotions] of Object.entries(emotionMap)) {
      if (query.toLowerCase().includes(key)) {
        keywords.push(...emotions);
      }
    }

    return keywords;
  }

  private calculateTemporalRelevance(
    memory: Memory,
    temporalContext: { start: Date; end: Date; description: string },
  ): number {
    if (!memory.occurredAt) return 0;

    const memoryTime = memory.occurredAt.getTime();
    const contextStart = temporalContext.start.getTime();
    const contextEnd = temporalContext.end.getTime();
    const windowDuration = contextEnd - contextStart;

    // Calculate relevance based on temporal distance and window size
    if (memoryTime >= contextStart && memoryTime <= contextEnd) {
      // Inside the target window - relevance based on position within window
      const positionInWindow = (memoryTime - contextStart) / windowDuration;
      // Higher relevance for memories closer to the center of the window
      const centerDistance = Math.abs(positionInWindow - 0.5);
      return Math.max(0.7, 1.0 - centerDistance);
    }

    // Outside the window - calculate proximity decay
    const closestBoundary = memoryTime < contextStart ? contextStart : contextEnd;
    const distance = Math.abs(memoryTime - closestBoundary);
    const maxRelevantDistance = windowDuration; // Memories within one window-length are still relevant
    
    if (distance > maxRelevantDistance) return 0;
    
    // Linear decay based on distance
    return Math.max(0.1, 0.6 * (1 - distance / maxRelevantDistance));
  }

  private calculateEmotionalRelevance(
    memory: MemoryWithEmotionalComponents,
    emotionalKeywords: string[],
  ): number {
    if (!memory.emotionalState?.components) return 0;

    let relevance = 0;
    for (const component of memory.emotionalState.components) {
      if (
        component.emotionType &&
        emotionalKeywords.includes(component.emotionType.emotionName.toLowerCase())
      ) {
        relevance += component.intensity * 0.5;
      }
    }

    return Math.min(1, relevance);
  }

  private async calculateAssociationRelevance(memory: Memory, originalQuery: string): Promise<number> {
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

  private async calculateCrossModalRelevance(memory: Memory, originalQuery: string): Promise<number> {
    // Note: Base relevance of 0.4 is still hardcoded - this needs LLM analysis for multi-modal content
    let relevance = 0.4;

    if (memory.searchText) {
      const textSimilarity = await this.calculateAssociationRelevance(memory, originalQuery);
      // Note: 0.6 weighting is hardcoded - this should be LLM-determined
      relevance += textSimilarity * 0.6;
    }

    return Math.min(1, relevance);
  }

  private async calculateFinalScore(
    result: RetrievalResult,
    query: RetrievalQuery,
    context: RetrievalContext,
  ): Promise<number> {
    let score = result.relevanceScore;

    // Adaptive significance weighting based on overall result quality
    const avgSignificance = context.totalResults.reduce((sum, r) => sum + r.memory.significanceScore, 0) / context.totalResults.length;
    const significanceWeight = result.memory.significanceScore > avgSignificance ? 
      Math.min(0.3, (result.memory.significanceScore - avgSignificance) * 0.5) : 0;
    score += significanceWeight;

    // Emotional boost only if emotionally relevant AND memory has strong emotional content
    if (await this.isEmotionallyRelevant(query.query) && result.memory.emotionalStateId) {
      // Check if this memory's emotional intensity is above average for emotional context
      const emotionalBoost = this.calculateEmotionalBoost(result.memory, context);
      score += emotionalBoost;
    }

    // Recency boost with decay based on query temporal relevance
    if (result.memory.occurredAt && await this.isTimeRelevant(query.query)) {
      const recencyBoost = this.calculateRecencyBoost(result.memory, query);
      score += recencyBoost;
    }

    return Math.min(1, score);
  }

  /**
   * Calculate emotional boost based on memory's emotional intensity relative to context
   */
  private calculateEmotionalBoost(memory: { emotionalStateId: string | null }, context: RetrievalContext): number {
    // Only boost if this memory has notably strong emotional content compared to others
    const emotionalMemories = context.totalResults.filter(r => r.memory.emotionalStateId);
    if (emotionalMemories.length === 0) return 0.05; // Small boost if only emotional memory
    
    // Compare emotional significance (simplified - could query actual intensity)
    return emotionalMemories.length > 3 ? 0.02 : 0.08; // Lower boost if many emotional memories
  }

  /**
   * Calculate recency boost with temporal decay based on query temporal context
   */
  private calculateRecencyBoost(memory: { occurredAt: Date | null }, query: RetrievalQuery): number {
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
   * Dynamically adjusts based on search context and results quality
   */
  private getAssociationStrengthForAgenticRetrieval(context: RetrievalContext): number {
    // Start with base threshold
    let threshold = 0.4;
    
    // Increase threshold if we already have many results (avoid noise)
    if (context.totalResults.length > 15) {
      threshold += 0.2;
    }
    
    // Decrease threshold if previous searches found few results (be more inclusive)
    if (context.totalResults.length < 5) {
      threshold -= 0.1;
    }
    
    // Adjust based on average quality of current results
    if (context.totalResults.length > 0) {
      const avgRelevance = context.totalResults.reduce((sum, r) => sum + r.relevanceScore, 0) / context.totalResults.length;
      if (avgRelevance > 0.7) {
        threshold += 0.1; // Be more selective if quality is already high
      } else if (avgRelevance < 0.4) {
        threshold -= 0.1; // Be more inclusive if quality is low
      }
    }
    
    return Math.max(0.2, Math.min(0.8, threshold));
  }

  /**
   * Get minimum emotional relevance for LLM context
   * Emotions must be significant enough to influence personality in conversation
   */
  private getMinimumEmotionalRelevanceForLLM(): number {
    // For LLM personality preservation, emotional memories should notably impact conversation style
    // 0.4 captures moderately significant emotional context that affects LLM responses
    return 0.4;
  }

  /**
   * Adaptive reflection analysis - determines search continuation based on results quality distribution
   * This replaces arbitrary hardcoded thresholds with actual result quality analysis
   */
  private analyzeSearchQuality(results: RetrievalResult[], strategy: string): { notes: string; shouldContinue: boolean } {
    if (results.length === 0) {
      return {
        notes: `${strategy} search yielded no results`,
        shouldContinue: true,
      };
    }

    // Calculate quality metrics
    const relevanceScores = results.map(r => r.relevanceScore);
    const avgRelevance = relevanceScores.reduce((sum, score) => sum + score, 0) / relevanceScores.length;
    const maxRelevance = Math.max(...relevanceScores);
    const minRelevance = Math.min(...relevanceScores);
    const variance = this.calculateVariance(relevanceScores);
    
    // Adaptive thresholds based on result distribution
    const highQualityThreshold = Math.max(0.6, avgRelevance + variance);
    const highQualityCount = results.filter(r => r.relevanceScore > highQualityThreshold).length;
    
    // Stop searching if we have excellent results with good consistency
    if (avgRelevance > 0.75 && variance < 0.1 && highQualityCount >= 2) {
      return {
        notes: `${strategy} search found excellent consistent results (avg: ${avgRelevance.toFixed(2)}, variance: ${variance.toFixed(3)})`,
        shouldContinue: false,
      };
    }
    
    // Continue if results are promising (good average with potential for improvement)
    if (avgRelevance > 0.4 && maxRelevance > 0.6) {
      return {
        notes: `${strategy} search found promising results (avg: ${avgRelevance.toFixed(2)}, max: ${maxRelevance.toFixed(2)})`,
        shouldContinue: true,
      };
    }
    
    // Continue if results are weak (need more context)
    return {
      notes: `${strategy} search found weak results (avg: ${avgRelevance.toFixed(2)})`,
      shouldContinue: true,
    };
  }
  
  /**
   * Calculate variance for adaptive threshold determination
   */
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
    return squaredDifferences.reduce((sum, diff) => sum + diff, 0) / values.length;
  }
}
