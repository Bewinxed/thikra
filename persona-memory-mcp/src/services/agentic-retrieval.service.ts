import type {
  EmotionalState,
  EmotionalStateComponent,
  Memory,
  MemoryAssociation,
  MemoryType,
  PrismaClient,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
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
      .filter((result) => result.relevanceScore > 0.3)
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
          minStrength: 0.5,
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

    const retrievalResults: RetrievalResult[] = memories.map((memory) => ({
      memory,
      relevanceScore: this.calculateAssociationRelevance(memory, query.query),
      retrievalReason: 'memory_association',
    }));

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

    const retrievalResults: RetrievalResult[] = memories.map((memory) => ({
      memory,
      relevanceScore: this.calculateCrossModalRelevance(memory, query.query),
      retrievalReason: 'cross_modal_association',
    }));

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
      result.relevanceScore = this.calculateFinalScore(result, query, context);
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

    // Simple heuristic reflection (could be enhanced with LLM)
    const avgRelevance = results.reduce((sum, r) => sum + r.relevanceScore, 0) / results.length;
    const highQualityResults = results.filter((r) => r.relevanceScore > 0.7).length;

    if (avgRelevance > 0.8 && highQualityResults >= 3) {
      return {
        notes: `${strategy} search found excellent matches (avg: ${avgRelevance.toFixed(2)})`,
        shouldContinue: false,
      };
    }

    if (avgRelevance > 0.5) {
      return {
        notes: `${strategy} search found good matches (avg: ${avgRelevance.toFixed(2)})`,
        shouldContinue: true,
      };
    }

    return {
      notes: `${strategy} search found weak matches (avg: ${avgRelevance.toFixed(2)})`,
      shouldContinue: true,
    };
  }

  /**
   * Helper methods for relevance detection and scoring
   */
  private isTimeRelevant(query: string): boolean {
    const timeWords = [
      'when',
      'yesterday',
      'today',
      'last',
      'recent',
      'ago',
      'before',
      'after',
      'during',
    ];
    return timeWords.some((word) => query.toLowerCase().includes(word));
  }

  private isEmotionallyRelevant(query: string): boolean {
    const emotionWords = [
      'feel',
      'emotion',
      'mood',
      'happy',
      'sad',
      'angry',
      'love',
      'fear',
      'excited',
    ];
    return emotionWords.some((word) => query.toLowerCase().includes(word));
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

    if (memoryTime >= contextStart && memoryTime <= contextEnd) {
      return 0.9; // High relevance for exact time match
    }

    return 0.3; // Lower relevance for temporal search hit
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

  private calculateAssociationRelevance(memory: Memory, originalQuery: string): number {
    // Simple text similarity for association relevance
    const memoryText = (memory.searchText || '').toLowerCase();
    const queryText = originalQuery.toLowerCase();

    const commonWords = memoryText
      .split(' ')
      .filter((word) => word.length > 3 && queryText.includes(word));

    return Math.min(1, commonWords.length * 0.2);
  }

  private calculateCrossModalRelevance(memory: Memory, originalQuery: string): number {
    // Base relevance for multi-modal content
    let relevance = 0.4;

    if (memory.searchText) {
      const textSimilarity = this.calculateAssociationRelevance(memory, originalQuery);
      relevance += textSimilarity * 0.6;
    }

    return Math.min(1, relevance);
  }

  private calculateFinalScore(
    result: RetrievalResult,
    query: RetrievalQuery,
    context: RetrievalContext,
  ): number {
    let score = result.relevanceScore;

    // Boost for significance
    score += result.memory.significanceScore * 0.2;

    // Boost for emotional content if query is emotional
    if (this.isEmotionallyRelevant(query.query) && result.memory.emotionalStateId) {
      score += 0.1;
    }

    // Boost for recency if query suggests recent content
    if (result.memory.occurredAt) {
      const hoursAgo = (Date.now() - result.memory.occurredAt.getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 24) score += 0.05;
    }

    return Math.min(1, score);
  }
}
