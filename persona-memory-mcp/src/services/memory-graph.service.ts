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

/**
 * Memory Graph Service implementing association traversal and graph operations
 *
 * References:
 * - Graph Theory in Memory: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5021692/
 * - Network Models of Memory: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3713906/
 */
export class MemoryGraphService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Build associations for a newly created memory
   */
  async buildAssociationsForMemory(memoryId: string): Promise<void> {
    // Get memory with raw query to include embedding field
    const [memory] = await this.prisma.$queryRaw<Array<MemoryWithEmotionalState>>`
      SELECT m.*, 
             m.embedding::text as embedding,
             CASE 
               WHEN es.id IS NOT NULL THEN json_build_object(
                 'id', es.id, 
                 'createdAt', es."createdAt",
                 'components', COALESCE(
                   (SELECT json_agg(
                     json_build_object(
                       'emotionTypeId', esc."emotionTypeId",
                       'intensity', esc.intensity,
                       'emotionType', json_build_object(
                         'id', et.id,
                         'emotionName', et."emotionName",
                         'primaryEmotion', et."primaryEmotion"
                       )
                     )
                   ) FROM "EmotionalStateComponent" esc
                   LEFT JOIN "EmotionType" et ON esc."emotionTypeId" = et.id
                   WHERE esc."emotionalStateId" = es.id),
                   '[]'::json
                 )
               )
               ELSE NULL 
             END as "emotionalState"
      FROM "Memory" m
      LEFT JOIN "EmotionalState" es ON m."emotionalStateId" = es.id
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

  /**
   * Discover memory clusters using graph analysis
   */
  async discoverMemoryClusters(
    personaId: string,
    minClusterSize = 3,
  ): Promise<
    Array<{
      clusterId: number;
      memories: string[];
      centralMemory: string;
      clusterTheme?: string;
    }>
  > {
    // Use recursive CTE to find strongly connected components
    const clusters = await this.prisma.$queryRaw<
      Array<{
        cluster_id: number;
        memory_ids: string;
        central_memory: string;
        avg_strength: number;
      }>
    >`
      WITH RECURSIVE memory_clusters AS (
        -- Start with each memory as its own cluster
        SELECT 
          m.id as memory_id,
          m.id as cluster_root,
          1 as cluster_size,
          m.id::text as memory_path,
          1.0 as path_strength
        FROM memories m
        WHERE m.persona_id = ${personaId}::uuid
        
        UNION ALL
        
        -- Expand clusters through strong associations
        SELECT 
          CASE 
            WHEN ma.memory_a = mc.memory_id THEN ma.memory_b
            ELSE ma.memory_a
          END as memory_id,
          mc.cluster_root,
          mc.cluster_size + 1,
          mc.memory_path || ',' || CASE 
            WHEN ma.memory_a = mc.memory_id THEN ma.memory_b
            ELSE ma.memory_a
          END,
          mc.path_strength * ma.association_strength
        FROM memory_clusters mc
        JOIN memory_associations ma ON 
          (ma.memory_a = mc.memory_id OR ma.memory_b = mc.memory_id)
        WHERE ma.association_strength >= 0.6
          AND mc.cluster_size < 10
          AND mc.memory_path NOT LIKE '%' || CASE 
            WHEN ma.memory_a = mc.memory_id THEN ma.memory_b
            ELSE ma.memory_a
          END || '%'
      ),
      cluster_groups AS (
        SELECT 
          cluster_root,
          string_agg(DISTINCT memory_id::text, ',') as memory_ids,
          COUNT(DISTINCT memory_id) as cluster_size,
          AVG(path_strength) as avg_strength
        FROM memory_clusters
        GROUP BY cluster_root
        HAVING COUNT(DISTINCT memory_id) >= ${minClusterSize}
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY cluster_size DESC, avg_strength DESC) as cluster_id,
        memory_ids,
        cluster_root as central_memory,
        avg_strength
      FROM cluster_groups
      ORDER BY cluster_size DESC, avg_strength DESC
      LIMIT 10
    `;

    return clusters.map((c) => ({
      clusterId: Number(c.cluster_id),
      memories: c.memory_ids.split(','),
      centralMemory: c.central_memory,
      clusterTheme: undefined, // Could analyze with LLM
    }));
  }

  /**
   * Find temporal chains of memories
   */
  async findTemporalChains(
    personaId: string,
    minChainLength = 3,
  ): Promise<
    Array<{
      chainId: number;
      memories: string[];
      startTime: Date;
      endTime: Date;
      duration: number;
    }>
  > {
    const chains = await this.prisma.$queryRaw<
      Array<{
        chain_id: number;
        memory_ids: string;
        start_time: Date;
        end_time: Date;
        duration_hours: number;
      }>
    >`
      WITH temporal_chains AS (
        SELECT 
          m1.id as start_memory,
          m2.id as end_memory,
          m1.occurred_at as start_time,
          m2.occurred_at as end_time,
          EXTRACT(EPOCH FROM (m2.occurred_at - m1.occurred_at)) / 3600 as duration_hours,
          array[m1.id, m2.id]::text[] as chain
        FROM "Memory" m1
        JOIN "MemoryAssociation" ma ON m1.id = ma."memoryA"
        JOIN "Memory" m2 ON ma."memoryB" = m2.id
        WHERE m1."personaId" = ${personaId}::uuid
          AND m2."personaId" = ${personaId}::uuid
          AND ma.association_type = 'temporal'
          AND m1.occurred_at < m2.occurred_at
          AND EXTRACT(EPOCH FROM (m2.occurred_at - m1.occurred_at)) / 3600 < 24 -- Within 24 hours
      ),
      extended_chains AS (
        SELECT 
          tc.*,
          m3.id as next_memory,
          m3.occurred_at as next_time,
          array_append(tc.chain, m3.id::text) as extended_chain
        FROM temporal_chains tc
        JOIN "MemoryAssociation" ma2 ON tc.end_memory = ma2."memoryA"
        JOIN "Memory" m3 ON ma2."memoryB" = m3.id
        WHERE ma2."associationType" = 'temporal'
          AND m3.occurred_at > tc.end_time
          AND EXTRACT(EPOCH FROM (m3.occurred_at - tc.end_time)) / 3600 < 24
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY array_length(chain, 1) DESC, start_time) as chain_id,
        array_to_string(chain, ',') as memory_ids,
        start_time,
        COALESCE(next_time, end_time) as end_time,
        EXTRACT(EPOCH FROM (COALESCE(next_time, end_time) - start_time)) / 3600 as duration_hours
      FROM (
        SELECT * FROM temporal_chains
        UNION ALL
        SELECT start_memory, next_memory as end_memory, start_time, next_time as end_time, 
               EXTRACT(EPOCH FROM (next_time - start_time)) / 3600 as duration_hours, extended_chain as chain
        FROM extended_chains
      ) all_chains
      WHERE array_length(chain, 1) >= ${minChainLength}
      ORDER BY array_length(chain, 1) DESC, start_time
      LIMIT 20
    `;

    return chains.map((c) => ({
      chainId: Number(c.chain_id),
      memories: c.memory_ids.split(','),
      startTime: c.start_time,
      endTime: c.end_time,
      duration: c.duration_hours,
    }));
  }

  /**
   * Find emotion-based memory networks
   */
  async findEmotionNetworks(
    personaId: string,
    emotionName?: string,
  ): Promise<
    Array<{
      networkId: number;
      dominantEmotion: string;
      memories: string[];
      emotionalIntensity: number;
    }>
  > {
    const whereClause = emotionName ? `AND et.emotion_name = ${emotionName}` : '';

    const networks = await this.prisma.$queryRaw<
      Array<{
        network_id: number;
        emotion_name: string;
        memory_ids: string;
        avg_intensity: number;
      }>
    >`
      WITH emotion_memories AS (
        SELECT 
          m.id as memory_id,
          et.emotion_name,
          esc.intensity,
          et.primary_emotion
        FROM memories m
        JOIN emotional_states es ON m.emotional_state_id = es.id
        JOIN emotional_state_components esc ON es.id = esc.emotional_state_id
        JOIN emotion_types et ON esc.emotion_type_id = et.id
        WHERE m.persona_id = ${personaId}::uuid
          ${whereClause}
      ),
      emotion_networks AS (
        SELECT 
          em1.emotion_name,
          em1.memory_id as root_memory,
          array_agg(DISTINCT em2.memory_id) as network_memories,
          AVG((em1.intensity + em2.intensity) / 2) as avg_intensity
        FROM emotion_memories em1
        JOIN memory_associations ma ON em1.memory_id = ma.memory_a
        JOIN emotion_memories em2 ON ma.memory_b = em2.memory_id
        WHERE em1.emotion_name = em2.emotion_name
          OR em1.primary_emotion = em2.primary_emotion
        GROUP BY em1.emotion_name, em1.memory_id
        HAVING COUNT(DISTINCT em2.memory_id) >= 2
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY array_length(network_memories, 1) DESC, avg_intensity DESC) as network_id,
        emotion_name,
        array_to_string(array_append(network_memories, root_memory), ',') as memory_ids,
        avg_intensity
      FROM emotion_networks
      ORDER BY array_length(network_memories, 1) DESC, avg_intensity DESC
      LIMIT 15
    `;

    return networks.map((n) => ({
      networkId: Number(n.network_id),
      dominantEmotion: n.emotion_name,
      memories: n.memory_ids.split(','),
      emotionalIntensity: n.avg_intensity,
    }));
  }

  /**
   * Find cross-modal association paths
   */
  async findCrossModalPaths(
    personaId: string,
    startContentType: string,
    endContentType: string,
  ): Promise<
    Array<{
      pathId: number;
      path: string[];
      contentTypes: string[];
      strength: number;
    }>
  > {
    const paths = await this.prisma.$queryRaw<
      Array<{
        path_id: number;
        memory_path: string;
        content_types: string;
        path_strength: number;
      }>
    >`
      WITH RECURSIVE cross_modal_paths AS (
        SELECT 
          m.id as current_memory,
          m.content_type,
          array[m.id::text] as path,
          array[m.content_type] as content_types,
          1.0 as strength,
          1 as depth
        FROM memories m
        WHERE m.persona_id = ${personaId}::uuid
          AND m.content_type = ${startContentType}
        
        UNION ALL
        
        SELECT 
          m2.id as current_memory,
          m2.content_type,
          array_append(cmp.path, m2.id::text),
          array_append(cmp.content_types, m2.content_type),
          cmp.strength * ma.association_strength,
          cmp.depth + 1
        FROM cross_modal_paths cmp
        JOIN "MemoryAssociation" ma ON cmp.current_memory = ma."memoryA"
        JOIN "Memory" m2 ON ma."memoryB" = m2.id
        WHERE cmp.depth < 5
          AND NOT m2.id::text = ANY(cmp.path)
          AND ma."associationType" = 'cross_modal'
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY strength DESC, depth ASC) as path_id,
        array_to_string(path, ',') as memory_path,
        array_to_string(content_types, ',') as content_types,
        strength as path_strength
      FROM cross_modal_paths
      WHERE content_type = ${endContentType}
        AND array_length(path, 1) > 1
      ORDER BY strength DESC, depth ASC
      LIMIT 10
    `;

    return paths.map((p) => ({
      pathId: Number(p.path_id),
      path: p.memory_path.split(','),
      contentTypes: p.content_types.split(','),
      strength: p.path_strength,
    }));
  }
}
