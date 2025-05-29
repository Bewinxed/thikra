import type { Memory, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

// Use Prisma's generated types with proper includes
type MemoryWithEmotionalState = Prisma.MemoryGetPayload<{
  include: {
    emotionalState: {
      include: {
        components: true;
      };
    };
  };
}> & {
  embedding?: number[] | string | null; // Add embedding field for raw queries
};

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
   * Helper method to create associations with consistent ordering
   */
  private createAssociation(memoryIdA: string, memoryIdB: string, type: string, strength: number) {
    const [memoryA, memoryB] = [memoryIdA, memoryIdB].sort() as [string, string];
    return {
      memoryA,
      memoryB,
      associationType: type,
      strength,
      metadata: {},
    };
  }

  /**
   * Build associations for a newly created memory using incremental processing
   * Only processes the new memory against existing memories to avoid O(n²) complexity
   */
  async buildAssociationsForNewMemory(memoryId: string): Promise<void> {
    // Get memory with raw query to include embedding field
    const [memory] = await this.prisma.$queryRaw<Array<MemoryWithEmotionalState>>`
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

    // Filter out weak associations and ensure consistent ordering
    const strongAssociations = allAssociations
      .filter((assoc) => assoc.strength >= 0.3)
      .map((assoc) => {
        // Ensure memoryA < memoryB for consistent bidirectional storage
        const [memoryA, memoryB] = [assoc.memoryA, assoc.memoryB].sort() as [string, string];
        return {
          memoryA,
          memoryB,
          associationType: assoc.associationType,
          associationStrength: assoc.strength,
        };
      });

    if (strongAssociations.length > 0) {
      await this.prisma.memoryAssociation.createMany({
        data: strongAssociations,
        skipDuplicates: true,
      });
    }
  }

  /**
   * Backward compatibility method - delegates to new incremental method
   * @deprecated Use buildAssociationsForNewMemory instead
   */
  async buildAssociationsForMemory(memoryId: string): Promise<void> {
    return this.buildAssociationsForNewMemory(memoryId);
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
      FROM "Memory" 
      WHERE "personaId" = ${memory.personaId}::uuid 
        AND id != ${memory.id}::uuid
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingValue}::vector
      LIMIT 10
    `;

    return similarMemories
      .filter((m) => m.similarity < 0.8) // pgvector uses distance (lower = more similar)
      .map((m) =>
        this.createAssociation(
          memory.id,
          m.id,
          'semantic',
          Math.max(0, 1 - m.similarity), // Convert distance to similarity
        ),
      );
  }

  /**
   * Find temporally related memories (before/after, same time period)
   * Uses PostgreSQL temporal functions for efficient calculation
   */
  private async findTemporalAssociations(memory: MemoryWithEmotionalState) {
    if (!memory.occurredAt) {
      return [];
    }

    // Use PostgreSQL to calculate temporal proximity and strength
    const temporalMemories = await this.prisma.$queryRaw<
      Array<{
        id: string;
        time_diff_hours: number;
        temporal_strength: number;
      }>
    >`
      SELECT 
        m.id,
        ABS(EXTRACT(EPOCH FROM (m."occurredAt" - ${memory.occurredAt}::timestamp))) / 3600.0 as time_diff_hours,
        GREATEST(0, 1 - (ABS(EXTRACT(EPOCH FROM (m."occurredAt" - ${memory.occurredAt}::timestamp))) / 86400.0)) as temporal_strength
      FROM "Memory" m
      WHERE m."personaId" = ${memory.personaId}::uuid
        AND m.id != ${memory.id}::uuid
        AND m."occurredAt" IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (m."occurredAt" - ${memory.occurredAt}::timestamp))) <= 86400 -- Within 24 hours (86400 seconds)
      ORDER BY ABS(EXTRACT(EPOCH FROM (m."occurredAt" - ${memory.occurredAt}::timestamp))) ASC
      LIMIT 20
    `;

    return temporalMemories
      .filter((m) => m.temporal_strength > 0)
      .map((m) => this.createAssociation(memory.id, m.id, 'temporal', m.temporal_strength));
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

      return this.createAssociation(memory.id, m.id, 'emotional', avgIntensity);
    });
  }

  /**
   * Find memories that reference or are referenced by this memory
   */
  private async findReferenceAssociations(memory: MemoryWithEmotionalState) {
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
      associations.push(this.createAssociation(memory.id, refMemory.id, 'reference', 0.9));
    }

    // Add backward references (other -> this)
    for (const refMemory of referencingMemories) {
      associations.push(this.createAssociation(refMemory.id, memory.id, 'reference', 0.9));
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
            WHEN "memoryA" = ${startMemoryId}::uuid THEN "memoryB"::text
            ELSE "memoryA"::text
          END as current_memory,
          ARRAY[${startMemoryId}::text, 
            CASE 
              WHEN "memoryA" = ${startMemoryId}::uuid THEN "memoryB"::text
              ELSE "memoryA"::text
            END
          ] as path,
          "associationStrength" as strength,
          ARRAY["associationType"]::varchar[] as types,
          1 as depth
        FROM "memory_associations"
        WHERE ("memoryA" = ${startMemoryId}::uuid OR "memoryB" = ${startMemoryId}::uuid)
          AND "associationStrength" >= 0.3
        
        UNION ALL
        
        -- Recursive case: extend paths
        SELECT 
          CASE 
            WHEN ma."memoryA" = mp.current_memory::uuid THEN ma."memoryB"::text
            ELSE ma."memoryA"::text
          END as current_memory,
          mp.path || CASE 
            WHEN ma."memoryA" = mp.current_memory::uuid THEN ma."memoryB"::text
            ELSE ma."memoryA"::text
          END,
          mp.strength * ma."associationStrength" as strength,
          mp.types || ma."associationType",
          mp.depth + 1
        FROM memory_paths mp
        JOIN "memory_associations" ma ON (
          ma."memoryA" = mp.current_memory::uuid OR ma."memoryB" = mp.current_memory::uuid
        )
        WHERE mp.depth < ${maxDepth}
          AND NOT (CASE 
            WHEN ma."memoryA" = mp.current_memory::uuid THEN ma."memoryB"::text
            ELSE ma."memoryA"::text
          END = ANY(mp.path))
          AND ma."associationStrength" >= 0.3
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
          1.0::double precision as path_strength
        FROM "Memory" m
        WHERE m."personaId" = ${personaId}::uuid
        
        UNION ALL
        
        -- Expand clusters through strong associations
        SELECT 
          CASE 
            WHEN ma."memoryA" = mc.memory_id THEN ma."memoryB"
            ELSE ma."memoryA"
          END as memory_id,
          mc.cluster_root,
          mc.cluster_size + 1,
          mc.memory_path || ',' || CASE 
            WHEN ma."memoryA" = mc.memory_id THEN ma."memoryB"
            ELSE ma."memoryA"
          END,
          mc.path_strength * ma."associationStrength"
        FROM memory_clusters mc
        JOIN "memory_associations" ma ON 
          (ma."memoryA" = mc.memory_id OR ma."memoryB" = mc.memory_id)
        WHERE ma."associationStrength" >= 0.6
          AND mc.cluster_size < 10
          AND mc.memory_path NOT LIKE '%' || CASE 
            WHEN ma."memoryA" = mc.memory_id THEN ma."memoryB"
            ELSE ma."memoryA"
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
          m1."occurredAt" as start_time,
          m2."occurredAt" as end_time,
          EXTRACT(EPOCH FROM (m2."occurredAt" - m1."occurredAt")) / 3600 as duration_hours,
          array[m1.id, m2.id]::text[] as chain
        FROM "Memory" m1
        JOIN "memory_associations" ma ON m1.id = ma."memoryA"
        JOIN "Memory" m2 ON ma."memoryB" = m2.id
        WHERE m1."personaId" = ${personaId}::uuid
          AND m2."personaId" = ${personaId}::uuid
          AND ma."associationType" = 'temporal'
          AND m1."occurredAt" < m2."occurredAt"
          AND m2."occurredAt" - m1."occurredAt" <= INTERVAL '24 hours' -- Within 24 hours
      ),
      extended_chains AS (
        SELECT 
          tc.*,
          m3.id as next_memory,
          m3."occurredAt" as next_time,
          array_append(tc.chain, m3.id::text) as extended_chain
        FROM temporal_chains tc
        JOIN "memory_associations" ma2 ON tc.end_memory = ma2."memoryA"
        JOIN "Memory" m3 ON ma2."memoryB" = m3.id
        WHERE ma2."associationType" = 'temporal'
          AND m3."occurredAt" > tc.end_time
          AND m3."occurredAt" - tc.end_time <= INTERVAL '24 hours'
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY array_length(chain, 1) DESC, start_time) as chain_id,
        array_to_string(chain, ',') as memory_ids,
        start_time,
        end_time,
        duration_hours
      FROM (
        SELECT start_memory, end_memory, start_time, end_time, duration_hours, chain FROM temporal_chains
        UNION ALL
        SELECT start_memory, next_memory as end_memory, start_time, next_time as end_time, 
               EXTRACT(EPOCH FROM (next_time - start_time)) / 3600.0 as duration_hours, extended_chain as chain
        FROM extended_chains
      ) all_chains
      WHERE array_length(chain, 1) >= ${minChainLength}
      ORDER BY array_length(chain, 1) DESC, start_time
      LIMIT 20
    `;

    return chains.map((c) => {
      const duration = Number(c.duration_hours);
      if (Number.isNaN(duration) || duration < 0) {
        throw new Error(`Invalid temporal chain duration: ${c.duration_hours} for chain ${c.chain_id}`);
      }
      return {
        chainId: Number(c.chain_id),
        memories: c.memory_ids.split(','),
        startTime: c.start_time,
        endTime: c.end_time,
        duration,
      };
    });
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
    const whereClause = emotionName
      ? Prisma.sql`AND et."emotionName" = ${emotionName}`
      : Prisma.empty;

    const networks = await this.prisma.$queryRaw<
      Array<{
        network_id: number;
        emotionName: string;
        memory_ids: string;
        avg_intensity: number;
      }>
    >`
      WITH emotion_memories AS (
        SELECT 
          m.id as memory_id,
          et."emotionName",
          esc.intensity,
          et."primaryEmotion"
        FROM "Memory" m
        JOIN "EmotionalState" es ON m."emotionalStateId" = es.id
        JOIN "EmotionalStateComponent" esc ON es.id = esc."emotionalStateId"
        JOIN "EmotionType" et ON esc."emotionTypeId" = et.id
        WHERE m."personaId" = ${personaId}::uuid
          ${whereClause}
      ),
      emotion_networks AS (
        SELECT 
          em1."emotionName",
          em1.memory_id as root_memory,
          array_agg(DISTINCT em2.memory_id) as network_memories,
          AVG((em1.intensity + em2.intensity) / 2) as avg_intensity
        FROM emotion_memories em1
        JOIN "memory_associations" ma ON em1.memory_id = ma."memoryA"
        JOIN emotion_memories em2 ON ma."memoryB" = em2.memory_id
        WHERE em1."emotionName" = em2."emotionName"
          OR em1."primaryEmotion" = em2."primaryEmotion"
        GROUP BY em1."emotionName", em1.memory_id
        HAVING COUNT(DISTINCT em2.memory_id) >= 2
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY array_length(network_memories, 1) DESC, avg_intensity DESC) as network_id,
        "emotionName",
        array_to_string(array_append(network_memories, root_memory), ',') as memory_ids,
        avg_intensity
      FROM emotion_networks
      ORDER BY array_length(network_memories, 1) DESC, avg_intensity DESC
      LIMIT 15
    `;

    return networks.map((n) => ({
      networkId: Number(n.network_id),
      dominantEmotion: n.emotionName,
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
          m."contentType",
          array[m.id::text] as path,
          array[m."contentType"]::varchar[] as content_types,
          1.0::double precision as strength,
          1 as depth
        FROM "Memory" m
        WHERE m."personaId" = ${personaId}::uuid
          AND m."contentType" = ${startContentType}
        
        UNION ALL
        
        SELECT 
          m2.id as current_memory,
          m2."contentType",
          array_append(cmp.path, m2.id::text),
          array_append(cmp.content_types, m2."contentType"),
          cmp.strength * ma."associationStrength",
          cmp.depth + 1
        FROM cross_modal_paths cmp
        JOIN "memory_associations" ma ON cmp.current_memory = ma."memoryA"
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
      WHERE "contentType" = ${endContentType}
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
