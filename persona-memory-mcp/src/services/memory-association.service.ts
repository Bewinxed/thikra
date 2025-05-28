import type {
  EmotionalState,
  EmotionalStateComponent,
  Memory,
  MemoryAssociation,
  PrismaClient,
} from '@prisma/client';

// pgvector embedding type - stored as vector(768) but accessed as number[] or string
type Embedding = number[] | string | null;

interface MemoryWithEmbedding extends Memory {
  embedding: Embedding;
}

interface MemoryWithEmotionalState extends MemoryWithEmbedding {
  emotionalState?:
    | (EmotionalState & {
        components: EmotionalStateComponent[];
      })
    | null;
}

export interface AssociationParams {
  memoryId: string;
  limit?: number;
  minStrength?: number;
  associationTypes?: string[];
}

export class MemoryAssociationBuilder {
  constructor(private prisma: PrismaClient) {}

  /**
   * Build associations for a newly created memory
   */
  async buildAssociationsForMemory(memoryId: string): Promise<void> {
    // Get memory with raw query to include embedding field
    const [memory] = await this.prisma.$queryRaw<Array<MemoryWithEmotionalState>>`
      SELECT m.*, 
             m.embedding::text as embedding,
             row_to_json(es.*) as "emotionalState"
      FROM memories m
      LEFT JOIN emotional_states es ON m.emotional_state_id = es.id
      WHERE m.id = ${memoryId}::uuid
    `;

    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    // Build different types of associations
    const [semanticAssocs, temporalAssocs, emotionalAssocs, referenceAssocs] = await Promise.all([
      this.findSemanticAssociations(memory),
      this.findTemporalAssociations(memory),
      this.findEmotionalAssociations(memory),
      this.findReferenceAssociations(memory),
    ]);

    // Combine all associations
    const allAssociations = [
      ...semanticAssocs,
      ...temporalAssocs,
      ...emotionalAssocs,
      ...referenceAssocs,
    ];

    // Filter out weak associations and create them in the database
    const strongAssociations = allAssociations.filter((assoc) => assoc.strength >= 0.3);

    if (strongAssociations.length > 0) {
      await this.prisma.memoryAssociation.createMany({
        data: strongAssociations.map((assoc) => ({
          memoryA: assoc.memoryA,
          memoryB: assoc.memoryB,
          associationType: assoc.associationType,
          associationStrength: assoc.strength,
        })),
        skipDuplicates: true,
      });
    }
  }

  /**
   * Find semantically similar memories using vector similarity
   */
  private async findSemanticAssociations(memory: MemoryWithEmotionalState) {
    if (!memory.embedding) {
      return [];
    }

    // Use vector similarity search with pgvector
    // Convert embedding to proper format for vector comparison
    const embeddingValue = Array.isArray(memory.embedding)
      ? `[${memory.embedding.join(',')}]`
      : memory.embedding;

    const similarMemories = await this.prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
      SELECT id, (embedding <=> ${embeddingValue}::vector) as similarity
      FROM memories 
      WHERE persona_id = ${memory.personaId}::uuid 
        AND id != ${memory.id}::uuid
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingValue}::vector
      LIMIT 10
    `;

    return similarMemories
      .filter((m) => m.similarity > 0.8) // High similarity threshold
      .map((m) => ({
        memoryA: memory.id,
        memoryB: m.id,
        associationType: 'semantic',
        strength: m.similarity,
        metadata: { similarity_score: m.similarity },
      }));
  }

  /**
   * Find temporally related memories (before/after, same time period)
   */
  private async findTemporalAssociations(memory: Memory) {
    if (!memory.occurredAt) {
      return [];
    }

    const timeWindow = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    const startTime = new Date((memory.occurredAt?.getTime() || 0) - timeWindow);
    const endTime = new Date((memory.occurredAt?.getTime() || 0) + timeWindow);

    const temporalMemories = await this.prisma.memory.findMany({
      where: {
        personaId: memory.personaId,
        id: { not: memory.id },
        occurredAt: {
          gte: startTime,
          lte: endTime,
        },
      },
      take: 20,
    });

    return temporalMemories.map((m) => {
      // Calculate temporal proximity (closer in time = stronger association)
      const timeDiff = Math.abs(
        (m.occurredAt?.getTime() || 0) - (memory.occurredAt?.getTime() || 0),
      );
      const strength = Math.max(0, 1 - timeDiff / timeWindow);

      return {
        memoryA: memory.id,
        memoryB: m.id,
        associationType: 'temporal',
        strength,
        metadata: {
          time_difference_hours: timeDiff / (60 * 60 * 1000),
        },
      };
    });
  }

  /**
   * Find emotionally similar memories
   */
  private async findEmotionalAssociations(memory: MemoryWithEmotionalState) {
    if (!memory.emotionalState?.components) {
      return [];
    }

    // Get dominant emotions from this memory
    const components = memory.emotionalState.components;
    const dominantEmotions = components
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 3)
      .map((e) => e.emotionTypeId);

    // Find memories with similar emotional states
    const emotionalMemories = await this.prisma.memory.findMany({
      where: {
        personaId: memory.personaId,
        id: { not: memory.id },
        emotionalState: {
          components: {
            some: {
              emotionTypeId: { in: dominantEmotions },
              intensity: { gte: 0.5 }, // Moderate to high intensity
            },
          },
        },
      },
      include: {
        emotionalState: {
          include: {
            components: {
              where: {
                emotionTypeId: { in: dominantEmotions },
              },
            },
          },
        },
      },
      take: 10,
    });

    return emotionalMemories.map((m) => {
      // Calculate emotional similarity based on shared emotions and intensity
      const sharedEmotions =
        m.emotionalState?.components.filter((e) => dominantEmotions.includes(e.emotionTypeId)) ||
        [];

      const avgIntensity =
        sharedEmotions.reduce((sum, e) => sum + e.intensity, 0) / (sharedEmotions.length || 1);

      return {
        memoryA: memory.id,
        memoryB: m.id,
        associationType: 'emotional',
        strength: avgIntensity,
        metadata: {
          shared_emotions: sharedEmotions.length,
          emotion_types: sharedEmotions.map((e) => e.emotionTypeId),
        },
      };
    });
  }

  /**
   * Find memories that reference or are referenced by this memory
   */
  private async findReferenceAssociations(memory: Memory) {
    const referencedIds = this.extractMemoryReferences(memory.searchText || '');

    if (referencedIds.length === 0) {
      return [];
    }

    // Find memories that this memory references
    const referencedMemories = await this.prisma.memory.findMany({
      where: {
        id: { in: referencedIds },
        personaId: memory.personaId,
      },
    });

    // Find memories that reference this memory
    const referencingMemories = await this.prisma.memory.findMany({
      where: {
        personaId: memory.personaId,
        id: { not: memory.id },
        searchText: { contains: memory.id },
      },
    });

    const associations = [];

    // Add forward references (this -> other)
    for (const refMemory of referencedMemories) {
      associations.push({
        memoryA: memory.id,
        memoryB: refMemory.id,
        associationType: 'reference',
        strength: 0.9,
        metadata: { direction: 'forward' },
      });
    }

    // Add backward references (other -> this)
    for (const refMemory of referencingMemories) {
      associations.push({
        memoryA: refMemory.id,
        memoryB: memory.id,
        associationType: 'reference',
        strength: 0.9,
        metadata: { direction: 'backward' },
      });
    }

    return associations;
  }

  /**
   * Extract memory IDs referenced in content
   */
  private extractMemoryReferences(content: string): string[] {
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const matches = content.match(uuidPattern) || [];
    return Array.from(new Set(matches)); // Remove duplicates
  }

  /**
   * Get related memories through associations
   */
  async getRelatedMemories(params: AssociationParams): Promise<
    Array<{
      memory: Memory;
      associationType: string;
      strength: number;
      path: string[];
    }>
  > {
    const { memoryId, limit = 10, minStrength = 0.3, associationTypes } = params;

    // Get direct associations
    const associations = await this.prisma.memoryAssociation.findMany({
      where: {
        OR: [{ memoryA: memoryId }, { memoryB: memoryId }],
        associationStrength: { gte: minStrength },
        ...(associationTypes && { associationType: { in: associationTypes } }),
      },
      include: {
        memoryARelation: true,
        memoryBRelation: true,
      },
      orderBy: { associationStrength: 'desc' },
      take: limit,
    });

    return associations.map((assoc) => {
      const isMemoryA = assoc.memoryA === memoryId;
      const relatedMemory = isMemoryA ? assoc.memoryBRelation : assoc.memoryARelation;

      return {
        memory: relatedMemory,
        associationType: assoc.associationType,
        strength: assoc.associationStrength,
        path: [memoryId, relatedMemory.id],
      };
    });
  }

  /**
   * Find memory paths between two memories
   */
  async findMemoryPath(
    startMemoryId: string,
    endMemoryId: string,
    maxDepth = 3,
  ): Promise<
    Array<{
      path: string[];
      strength: number;
      types: string[];
    }>
  > {
    // Use recursive CTE to find paths
    const paths = await this.prisma.$queryRaw<
      Array<{ path: string; strength: number; types: string }>
    >`
      WITH RECURSIVE memory_paths AS (
        -- Base case: direct associations
        SELECT 
          CASE 
            WHEN memory_a = ${startMemoryId}::uuid THEN memory_b::text
            ELSE memory_a::text
          END as current_memory,
          ARRAY[${startMemoryId}::text, 
            CASE 
              WHEN memory_a = ${startMemoryId}::uuid THEN memory_b::text
              ELSE memory_a::text
            END
          ] as path,
          association_strength as strength,
          ARRAY[association_type] as types,
          1 as depth
        FROM memory_associations
        WHERE (memory_a = ${startMemoryId}::uuid OR memory_b = ${startMemoryId}::uuid)
          AND association_strength >= 0.3
        
        UNION ALL
        
        -- Recursive case: extend paths
        SELECT 
          CASE 
            WHEN ma.memory_a = mp.current_memory::uuid THEN ma.memory_b::text
            ELSE ma.memory_a::text
          END as current_memory,
          mp.path || CASE 
            WHEN ma.memory_a = mp.current_memory::uuid THEN ma.memory_b::text
            ELSE ma.memory_a::text
          END,
          mp.strength * ma.association_strength as strength,
          mp.types || ma.association_type,
          mp.depth + 1
        FROM memory_paths mp
        JOIN memory_associations ma ON (
          ma.memory_a = mp.current_memory::uuid OR ma.memory_b = mp.current_memory::uuid
        )
        WHERE mp.depth < ${maxDepth}
          AND NOT (CASE 
            WHEN ma.memory_a = mp.current_memory::uuid THEN ma.memory_b::text
            ELSE ma.memory_a::text
          END = ANY(mp.path))
          AND ma.association_strength >= 0.3
      )
      SELECT array_to_string(path, ',') as path, strength, array_to_string(types, ',') as types
      FROM memory_paths 
      WHERE current_memory = ${endMemoryId}
      ORDER BY strength DESC, depth ASC
      LIMIT 5
    `;

    return paths.map((p) => ({
      path: p.path.split(','),
      strength: p.strength,
      types: p.types.split(','),
    }));
  }
}
