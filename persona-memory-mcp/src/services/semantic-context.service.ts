import type {
  EmotionalState,
  Memory,
  PersonalityParameter,
  PrismaClient,
  Relationship,
  SemanticLink,
  SemanticSourceType,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { EmbeddingService } from './embedding.service';

interface RelatedContext {
  relatedMemories: Memory[];
  relatedEmotions: EmotionalState[];
  relatedPersonality: PersonalityParameter[];
  relatedRelationships: Relationship[];
  semanticConnections: SemanticConnection[];
}

interface SemanticConnection {
  sourceType: SemanticSourceType;
  sourceId: string;
  similarity: number;
  contextType: 'temporal' | 'emotional' | 'conceptual' | 'relational';
}

interface ContextualEmbeddingSource {
  sourceType: SemanticSourceType;
  sourceId: string;
  personaId: string;
  content: string;
  timestamp?: Date;
  participantEntityIds?: string[];
  emotionalContextId?: string;
  relationshipContextIds?: string[];
}

/**
 * Semantic Context Service for Phase 5.5
 *
 * Creates cross-model semantic links without data duplication.
 * Enables finding related emotions, personality traits, and relationships
 * via semantic similarity across all persona models.
 *
 * Key Features:
 * - Cross-model semantic search (memories ↔ emotions ↔ personality ↔ relationships)
 * - Contextual embeddings with metadata references (no duplication)
 * - Persona-scoped semantic isolation
 * - Entity-specific relationship context
 */
export class SemanticContextService {
  constructor(
    private prisma: PrismaClient,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * Create contextual description for Anthropic-style contextual retrieval
   * This gets stored as metadata, NOT embedded (embeddings are referenced from existing entities)
   */
  async createContextualDescription(source: ContextualEmbeddingSource): Promise<string> {
    // Get existing context from database (no duplication)
    const context = await this.assembleContextFromReferences(source);

    // Create contextual description following Anthropic's approach
    const contextualDescription = `
      ${source.sourceType} from persona context:
      ${context.temporalContext ? `Time: ${context.temporalContext}` : ''}
      ${context.participantContext ? `Participants: ${context.participantContext}` : ''}
      ${context.emotionalContext ? `Emotional state: ${context.emotionalContext}` : ''}
      ${context.relationshipContext ? `Relationships: ${context.relationshipContext}` : ''}
    `.trim();

    return contextualDescription;
  }

  /**
   * Create semantic link that references existing embeddings (NO duplication!)
   * Follows Anthropic contextual retrieval pattern
   */
  async createSemanticLink(source: ContextualEmbeddingSource): Promise<SemanticLink> {
    // Create contextual description for enhanced retrieval (stored as metadata)
    const contextualDescription = await this.createContextualDescription(source);

    // Store temporal context as PostgreSQL tsrange if timestamp available
    const temporalContext = source.timestamp
      ? `[${source.timestamp.toISOString()}, ${new Date(source.timestamp.getTime() + 24 * 60 * 60 * 1000).toISOString()}]`
      : null;

    // Create semantic link that REFERENCES existing embeddings (no duplication!)
    const semanticLink = await this.prisma.semanticLink.create({
      data: {
        personaId: source.personaId,
        sourceType: source.sourceType,
        sourceId: source.sourceId, // References existing Memory/Entity/etc with embedding
        contextualDescription, // Anthropic-style contextual metadata
        participantEntityIds: source.participantEntityIds || [],
        emotionalContextId: source.emotionalContextId,
        relationshipContextIds: source.relationshipContextIds || [],
        confidenceScore: 1.0,
        relevanceDecay: 0.1,
      },
    });

    // Set temporal context via raw SQL if provided (Prisma can't handle Unsupported types in create)
    if (temporalContext) {
      await this.prisma.$executeRaw`
        UPDATE "SemanticLink" 
        SET "temporalContext" = ${temporalContext}::tsrange
        WHERE id = ${semanticLink.id}::uuid
      `;
    }

    return semanticLink;
  }

  /**
   * Find related context across all models via semantic similarity
   * Core functionality for enhanced AgenticRetrieval
   */
  async findRelatedContext(
    queryEmbedding: number[],
    personaId: string,
    contextTypes?: SemanticSourceType[],
    maxResults = 20,
    similarityThreshold = 0.7,
  ): Promise<RelatedContext> {
    // Find semantic links for this persona (they reference existing embeddings)
    const semanticLinks = await this.prisma.semanticLink.findMany({
      where: {
        personaId,
        ...(contextTypes && { sourceType: { in: contextTypes } }),
      },
      include: {
        emotionalContext: true,
      },
    });

    // Get similarities by comparing with actual embeddings from source entities
    const similarItems: Array<{ link: SemanticLink; similarity: number }> = [];

    for (const link of semanticLinks) {
      // Get embedding from the source entity via raw SQL (Memory has embeddings)
      if (link.sourceType === 'memory') {
        try {
          // Use proper vector casting for pgvector with Prisma
          const memoryWithEmbedding = await this.prisma.$queryRaw<Array<{ embedding: string }>>`
            SELECT embedding::text FROM "Memory" WHERE id = ${link.sourceId}::uuid AND embedding IS NOT NULL
          `;

          if (memoryWithEmbedding[0]?.embedding) {
            const sourceEmbedding = this.parseVectorString(memoryWithEmbedding[0].embedding);
            const similarity = this.calculateCosineSimilarity(queryEmbedding, sourceEmbedding);
            if (similarity >= similarityThreshold) {
              similarItems.push({ link, similarity });
            }
          }
        } catch (error) {
          // Memory doesn't exist or embedding is null - skip this link
          console.warn(`Could not get embedding for memory ${link.sourceId}:`, error);
        }
      }
    }

    // Sort by similarity and limit results
    similarItems.sort((a, b) => b.similarity - a.similarity);
    const topResults = similarItems.slice(0, maxResults);

    // Group by source type
    const groupedLinks = {
      memory: topResults.filter((item) => item.link.sourceType === 'memory'),
      emotion: topResults.filter((item) => item.link.sourceType === 'emotion'),
      personality: topResults.filter((item) => item.link.sourceType === 'personality'),
      relationship: topResults.filter((item) => item.link.sourceType === 'relationship'),
    };

    // Fetch actual entities
    const [memories, emotions, personality, relationships] = await Promise.all([
      this.fetchMemories(groupedLinks.memory.map((item) => item.link.sourceId)),
      this.fetchEmotionalStates(groupedLinks.emotion.map((item) => item.link.sourceId)),
      this.fetchPersonalityParameters(groupedLinks.personality.map((item) => item.link.sourceId)),
      this.fetchRelationships(groupedLinks.relationship.map((item) => item.link.sourceId)),
    ]);

    // Create semantic connections with contextual descriptions
    const semanticConnections: SemanticConnection[] = topResults.map((item) => ({
      sourceType: item.link.sourceType,
      sourceId: item.link.sourceId,
      similarity: item.similarity,
      contextType: this.inferContextType(item.link),
    }));

    return {
      relatedMemories: memories,
      relatedEmotions: emotions,
      relatedPersonality: personality,
      relatedRelationships: relationships,
      semanticConnections,
    };
  }

  /**
   * Link contexts between different entities
   * Creates bidirectional semantic associations
   */
  async linkContexts(
    sourceId: string,
    sourceType: SemanticSourceType,
    relatedIds: string[],
    relatedTypes: SemanticSourceType[],
    personaId: string,
  ): Promise<void> {
    // This could be used to create explicit semantic relationships
    // For now, relationships are discovered via vector similarity
    // Could be extended for manual or LLM-suggested associations
  }

  /**
   * Assemble context from existing database references (no duplication)
   */
  private async assembleContextFromReferences(source: ContextualEmbeddingSource) {
    const context = {
      temporalContext: '',
      participantContext: '',
      emotionalContext: '',
      relationshipContext: '',
    };

    // Get participant entity names if available
    if (source.participantEntityIds?.length) {
      const entities = await this.prisma.entity.findMany({
        where: { id: { in: source.participantEntityIds } },
        select: { name: true },
      });
      context.participantContext = entities
        .map((e) => e.name)
        .filter(Boolean)
        .join(', ');
    }

    // Get emotional context if available
    if (source.emotionalContextId) {
      const emotionalState = await this.prisma.emotionalState.findUnique({
        where: { id: source.emotionalContextId },
        include: {
          components: {
            include: { emotionType: true },
          },
        },
      });

      if (emotionalState) {
        const emotions = emotionalState.components
          .map((c) => `${c.emotionType.emotionName}:${c.intensity}`)
          .join(', ');
        context.emotionalContext = emotions;
      }
    }

    // Get relationship context if available
    if (source.relationshipContextIds?.length) {
      const relationships = await this.prisma.relationship.findMany({
        where: { id: { in: source.relationshipContextIds } },
        include: { entity: true },
      });

      context.relationshipContext = relationships
        .map((r) => `${r.entity.name}:trust=${r.trustLevel},intimacy=${r.intimacyLevel}`)
        .join(', ');
    }

    return context;
  }

  private async fetchMemories(memoryIds: string[]): Promise<Memory[]> {
    if (memoryIds.length === 0) return [];
    return this.prisma.memory.findMany({
      where: { id: { in: memoryIds } },
    });
  }

  private async fetchEmotionalStates(emotionIds: string[]): Promise<EmotionalState[]> {
    if (emotionIds.length === 0) return [];
    return this.prisma.emotionalState.findMany({
      where: { id: { in: emotionIds } },
      include: {
        components: {
          include: { emotionType: true },
        },
      },
    });
  }

  private async fetchPersonalityParameters(
    personalityIds: string[],
  ): Promise<PersonalityParameter[]> {
    if (personalityIds.length === 0) return [];
    return this.prisma.personalityParameter.findMany({
      where: { id: { in: personalityIds } },
    });
  }

  private async fetchRelationships(relationshipIds: string[]): Promise<Relationship[]> {
    if (relationshipIds.length === 0) return [];
    return this.prisma.relationship.findMany({
      where: { id: { in: relationshipIds } },
      include: { entity: true },
    });
  }

  private inferContextType(
    link: SemanticLink,
  ): 'temporal' | 'emotional' | 'conceptual' | 'relational' {
    // Simple heuristics for context type inference
    // Note: temporalContext is an Unsupported type in Prisma, so we can't access it directly
    // For now, infer context type from other available fields
    if (link.emotionalContextId) return 'emotional';
    if (link.relationshipContextIds.length > 0) return 'relational';
    return 'conceptual';
  }

  /**
   * Semantic deduplication for handling LLM non-determinism
   * Environment-configurable threshold for merging similar entities
   */
  async deduplicateEntities(
    personaId: string,
    sourceType: SemanticSourceType,
    threshold: number = Number.parseFloat(process.env.SEMANTIC_DEDUPLICATION_THRESHOLD || '0.85'),
  ): Promise<{ merged: number; duplicates: string[] }> {
    // Get all semantic links of this type for the persona
    const links = await this.prisma.semanticLink.findMany({
      where: { personaId, sourceType },
      orderBy: { createdAt: 'asc' }, // Keep oldest as canonical
    });

    if (links.length < 2) return { merged: 0, duplicates: [] };

    const duplicates: string[] = [];
    let merged = 0;

    // Compare each link with earlier ones to find duplicates by accessing source embeddings
    for (let i = 1; i < links.length; i++) {
      const currentLink = links[i];
      if (!currentLink) continue;

      // Get embedding from the source entity via raw SQL
      let currentEmbedding: number[] | null = null;
      if (sourceType === 'memory') {
        try {
          const memoryWithEmbedding = await this.prisma.$queryRaw<Array<{ embedding: string }>>`
            SELECT embedding::text FROM "Memory" WHERE id = ${currentLink.sourceId}::uuid AND embedding IS NOT NULL
          `;
          currentEmbedding = memoryWithEmbedding[0]?.embedding
            ? this.parseVectorString(memoryWithEmbedding[0].embedding)
            : null;
        } catch (error) {
          console.warn(`Could not get embedding for memory ${currentLink.sourceId}:`, error);
          continue;
        }
      }

      if (!currentEmbedding) continue;

      for (let j = 0; j < i; j++) {
        const earlierLink = links[j];
        if (!earlierLink) continue;

        // Get embedding from the earlier source entity via raw SQL
        let earlierEmbedding: number[] | null = null;
        if (sourceType === 'memory') {
          try {
            const memoryWithEmbedding = await this.prisma.$queryRaw<Array<{ embedding: string }>>`
              SELECT embedding::text FROM "Memory" WHERE id = ${earlierLink.sourceId}::uuid AND embedding IS NOT NULL
            `;
            earlierEmbedding = memoryWithEmbedding[0]?.embedding
              ? this.parseVectorString(memoryWithEmbedding[0].embedding)
              : null;
          } catch (error) {
            console.warn(`Could not get embedding for memory ${earlierLink.sourceId}:`, error);
            continue;
          }
        }

        if (!earlierEmbedding) continue;

        const similarity = this.calculateCosineSimilarity(currentEmbedding, earlierEmbedding);

        if (similarity >= threshold) {
          // Mark for deduplication - merge into earlier (canonical) entity
          duplicates.push(currentLink.sourceId);

          // Update semantic link to point to canonical entity
          await this.prisma.semanticLink.update({
            where: { id: currentLink.id },
            data: { sourceId: earlierLink.sourceId },
          });

          merged++;
          break; // Only merge with first similar entity found
        }
      }
    }

    return { merged, duplicates };
  }

  private parseVectorString(vectorStr: string): number[] {
    try {
      // Handle PostgreSQL vector format: [1.0,2.0,3.0] or (1.0,2.0,3.0)
      // Remove brackets/parentheses and split by comma
      const cleanStr = vectorStr.replace(/^[\[\(]|[\]\)]$/g, '');
      const values = cleanStr.split(',').map((s) => {
        const num = Number.parseFloat(s.trim());
        if (Number.isNaN(num)) {
          throw new Error(`Invalid number: ${s.trim()}`);
        }
        return num;
      });

      if (values.length === 0) {
        throw new Error('Empty vector');
      }

      return values;
    } catch (error) {
      console.warn('Failed to parse vector string:', vectorStr, error);
      return [];
    }
  }

  private calculateCosineSimilarity(a: number[], b: number[]): number {
    // Handle undefined embeddings (return low similarity)
    if (!a || !b || !Array.isArray(a) || !Array.isArray(b)) {
      return 0;
    }

    // Validate dimensions match
    if (a.length !== b.length || a.length === 0) {
      console.warn(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
      return 0;
    }

    // Calculate cosine similarity
    const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

    // Prevent division by zero
    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    const similarity = dotProduct / (magnitudeA * magnitudeB);

    // Clamp result to valid range [-1, 1]
    return Math.max(-1, Math.min(1, similarity));
  }
}
