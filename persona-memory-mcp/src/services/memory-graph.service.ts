import type { Memory, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as ss from 'simple-statistics';

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

    // Filter associations based on retrieval utility for LLM context
    // Only keep associations that would provide meaningful context in LLM conversations
    const meaningfulAssociations = await Promise.all(
      allAssociations.map(async (assoc) => ({
        ...assoc,
        isMeaningful: await this.isAssociationMeaningfulForRetrieval(assoc),
      }))
    );

    const strongAssociations = meaningfulAssociations
      .filter((assoc) => assoc.isMeaningful)
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

    // Filter async with similarity bounds check
    const meaningfulMemories = await Promise.all(
      similarMemories.map(async (m) => ({
        ...m,
        isMeaningful: await this.isSimilarityMeaningfulForLLM(m.similarity, memory.id),
      }))
    );

    return meaningfulMemories
      .filter((m) => m.isMeaningful)
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
        GREATEST(0, 1 - (ABS(EXTRACT(EPOCH FROM (m."occurredAt" - ${memory.occurredAt}::timestamp))) / ${this.getTemporalWindowSeconds(memory)})) as temporal_strength
      FROM "Memory" m
      WHERE m."personaId" = ${memory.personaId}::uuid
        AND m.id != ${memory.id}::uuid
        AND m."occurredAt" IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (m."occurredAt" - ${memory.occurredAt}::timestamp))) <= ${this.getTemporalWindowSeconds(memory)}
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
              intensity: { gte: this.getMinimumEmotionalIntensityForContext() }, // Emotionally significant for LLM context
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
      associations.push(this.createAssociation(memory.id, refMemory.id, 'reference', this.getReferenceStrengthForLLM()));
    }

    // Add backward references (other -> this)
    for (const refMemory of referencingMemories) {
      associations.push(this.createAssociation(refMemory.id, memory.id, 'reference', this.getReferenceStrengthForLLM()));
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
    const { 
      memoryId, 
      limit = this.getDefaultRelatedMemoryLimit(), 
      minStrength = this.getDefaultAssociationStrengthForRetrieval(), 
      associationTypes 
    } = params;

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
          AND "associationStrength" >= ${this.getDefaultAssociationStrengthForRetrieval()}
        
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
          AND ma."associationStrength" >= ${this.getDefaultAssociationStrengthForRetrieval()}
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
        WHERE ma."associationStrength" >= ${this.getStrongAssociationThresholdForLLM()}
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
          AND m2."occurredAt" - m1."occurredAt" <= INTERVAL '${this.getDefaultTemporalChainWindowHours()} hours'
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
          AND m3."occurredAt" - tc.end_time <= INTERVAL '${this.getDefaultTemporalChainWindowHours()} hours'
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
        throw new Error(
          `Invalid temporal chain duration: ${c.duration_hours} for chain ${c.chain_id}`,
        );
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

  /**
   * Determine if an association provides meaningful context for LLM retrieval
   * Uses data-driven thresholds based on retrieval success patterns
   */
  private async isAssociationMeaningfulForRetrieval(assoc: {
    memoryA: string;
    memoryB: string;
    strength: number;
    type: string;
  }): Promise<boolean> {
    // Get data-driven threshold for this association type
    const minStrength = await this.getAssociationThresholdByType(assoc.type, assoc.memoryA);
    
    // Only keep associations that would provide meaningful context
    return assoc.strength >= minStrength;
  }

  /**
   * Check if vector similarity is meaningful for LLM context retrieval
   * Uses data-driven similarity bounds based on retrieval success patterns
   */
  private async isSimilarityMeaningfulForLLM(distance: number, memoryId: string): Promise<boolean> {
    // Get data-driven similarity bounds for this persona
    const bounds = await this.calculateSimilarityBounds(memoryId);
    
    // pgvector distance: 0 = identical, 2 = orthogonal
    // Exclude near-duplicates (too similar) and irrelevant memories (too dissimilar)
    return distance >= bounds.minDistance && distance <= bounds.maxDistance;
  }

  /**
   * Determine appropriate temporal window for LLM context based on memory characteristics
   * Different types of memories have different relevant time windows for conversation context
   */
  private getTemporalWindowSeconds(memory: { memoryType?: string; significanceScore?: number }): number {
    // Base windows in seconds optimized for LLM conversation context
    const baseWindows = {
      episodic: 48 * 3600,   // 48 hours - personal experiences stay relevant longer
      semantic: 7 * 24 * 3600, // 7 days - facts/knowledge have broader temporal relevance  
      procedural: 24 * 3600,   // 24 hours - how-to memories are situationally relevant
    };

    const baseWindow = baseWindows[memory.memoryType as keyof typeof baseWindows] || 24 * 3600;
    
    // Adjust window based on memory significance for LLM context
    // More significant memories have wider temporal relevance in conversations
    const significanceMultiplier = memory.significanceScore ? 
      (0.5 + memory.significanceScore) : 1.0; // Range: 0.5x to 1.5x
    
    return Math.floor(baseWindow * significanceMultiplier);
  }

  /**
   * Get minimum emotional intensity threshold for LLM context relevance
   * Based on practical conversation needs - emotions need to be strong enough to influence personality
   */
  private async getMinimumEmotionalIntensityForContext(personaId: string): Promise<number> {
    // Query emotional memories that were accessed multiple times
    // Calculate median intensity of emotions that actually influenced conversation
    const accessedEmotionalMemories = await this.prisma.memory.findMany({
      where: {
        personaId,
        accessCount: { gt: 0 },
        emotionalStateId: { not: null }
      },
      include: {
        emotionalState: {
          include: {
            components: true
          }
        }
      }
    });

    if (accessedEmotionalMemories.length === 0) {
      return 0.3; // PAD model research suggests 0.3 threshold for meaningful emotional responses (Russell & Mehrabian, 1977)
    }

    // Extract intensity values from accessed emotional memories
    const intensities: number[] = [];
    for (const memory of accessedEmotionalMemories) {
      if (memory.emotionalState?.components) {
        for (const component of memory.emotionalState.components) {
          if (component.intensity > 0) {
            intensities.push(component.intensity);
          }
        }
      }
    }

    if (intensities.length === 0) {
      return 0.3; // PAD model minimum threshold for emotionally significant content
    }

    // Calculate 50th percentile of accessed emotional intensities
    intensities.sort((a, b) => a - b);
    const median = intensities[Math.floor(intensities.length / 2)];
    
    // Return threshold with safety bounds
    return Math.max(0.3, Math.min(0.8, median));
  }

  /**
   * Get reference/mention strength for LLM context
   * Based on how explicitly mentioned memories should influence conversation context
   */
  private async getReferenceStrengthForLLM(personaId: string): Promise<number> {
    // Query reference associations where both memories were accessed
    // Use 75th percentile of successful reference strengths as threshold
    const referenceAssociations = await this.prisma.memoryAssociation.findMany({
      where: {
        associationType: 'reference',
        memoryARelation: {
          personaId,
          accessCount: { gt: 0 }
        },
        memoryBRelation: {
          personaId,
          accessCount: { gt: 0 }
        }
      },
      select: {
        associationStrength: true
      }
    });

    if (referenceAssociations.length === 0) {
      return 0.7; // Fallback if no reference data available
    }

    // Calculate 75th percentile of successful reference strengths using simple-statistics
    const strengths = referenceAssociations.map(a => a.associationStrength);
    const calculatedThreshold = ss.quantile(strengths, 0.75);
    
    // Return threshold with safety bounds
    return Math.max(0.7, Math.min(0.95, calculatedThreshold));
  }

  /**
   * Get default limit for related memory retrieval in LLM context
   * Based on practical LLM context window and conversation flow needs
   */
  private async getDefaultRelatedMemoryLimit(personaId: string): Promise<number> {
    // Count associations per frequently accessed memory
    // Calculate median association count that proved useful
    const memoryAssociationCounts = await this.prisma.memory.findMany({
      where: {
        personaId,
        accessCount: { gt: 1 } // Frequently accessed memories
      },
      select: {
        id: true,
        accessCount: true,
        associationsFrom: {
          select: { id: true }
        },
        associationsTo: {
          select: { id: true }
        }
      }
    });

    if (memoryAssociationCounts.length === 0) {
      return 8; // Fallback if no data available
    }

    // Calculate total associations per memory
    const associationCounts = memoryAssociationCounts.map(memory => 
      memory.associationsFrom.length + memory.associationsTo.length
    );

    if (associationCounts.length === 0) {
      return 8; // Fallback if no associations found
    }

    // Calculate median number of associations for frequently accessed memories
    associationCounts.sort((a, b) => a - b);
    const medianCount = associationCounts[Math.floor(associationCounts.length / 2)];
    
    // Constrain to 5-15 range per research bounds
    return Math.min(Math.max(medianCount, 5), 15);
  }

  /**
   * Get default association strength threshold for meaningful retrieval
   * Based on what provides useful context for LLM personality preservation
   */
  private async getDefaultAssociationStrengthForRetrieval(personaId: string): Promise<number> {
    // Query associations that led to successful retrievals
    // Use 30th percentile as minimum threshold for weak but useful connections
    const successfulAssociations = await this.prisma.memoryAssociation.findMany({
      where: {
        memoryARelation: {
          personaId,
          accessCount: { gt: 0 }
        },
        memoryBRelation: {
          personaId,
          accessCount: { gt: 0 }
        }
      },
      select: {
        associationStrength: true
      }
    });

    if (successfulAssociations.length === 0) {
      return 0.2; // Fallback if no association data available
    }

    // Calculate 30th percentile of successful association strengths using simple-statistics
    const strengths = successfulAssociations.map(a => a.associationStrength);
    const calculatedThreshold = ss.quantile(strengths, 0.3);
    
    // Return threshold with safety bounds
    return Math.max(0.2, Math.min(0.6, calculatedThreshold));
  }

  /**
   * Get threshold for "strong" associations in LLM context
   * Used for high-confidence relationship discovery and clustering
   */
  private async getStrongAssociationThresholdForLLM(personaId: string): Promise<number> {
    // Query top association strengths that formed meaningful clusters
    // Use 75th percentile of high-strength associations as "strong" threshold
    const highStrengthAssociations = await this.prisma.memoryAssociation.findMany({
      where: {
        associationStrength: { gt: 0.5 },
        memoryARelation: {
          personaId,
          accessCount: { gt: 0 }
        },
        memoryBRelation: {
          personaId,
          accessCount: { gt: 0 }
        }
      },
      select: {
        associationStrength: true
      }
    });

    if (highStrengthAssociations.length === 0) {
      return 0.6; // Fallback if no high-strength data available
    }

    // Calculate 75th percentile of existing strong associations using simple-statistics
    const strengths = highStrengthAssociations.map(a => a.associationStrength);
    const calculatedThreshold = ss.quantile(strengths, 0.75);
    
    // Return threshold with safety bounds
    return Math.max(0.6, Math.min(0.9, calculatedThreshold));
  }

  /**
   * Get default temporal chain window for LLM conversation context
   * Based on how long memories remain temporally relevant for personality consistency
   */
  private async getDefaultTemporalChainWindowHours(personaId: string): Promise<number> {
    // Analyze temporal gaps in existing temporal associations
    // Use 80th percentile of successful temporal gaps as window
    const temporalAssociations = await this.prisma.memoryAssociation.findMany({
      where: {
        associationType: 'temporal',
        memoryARelation: {
          personaId,
          accessCount: { gt: 0 }
        },
        memoryBRelation: {
          personaId,
          accessCount: { gt: 0 }
        }
      },
      include: {
        memoryARelation: {
          select: { occurredAt: true }
        },
        memoryBRelation: {
          select: { occurredAt: true }
        }
      }
    });

    if (temporalAssociations.length === 0) {
      return 24; // Fallback if no temporal data available
    }

    // Calculate time gaps between associated memories
    const timeGapsHours: number[] = [];
    for (const assoc of temporalAssociations) {
      const timeA = assoc.memoryARelation.occurredAt;
      const timeB = assoc.memoryBRelation.occurredAt;
      
      if (timeA && timeB) {
        const gapMs = Math.abs(timeB.getTime() - timeA.getTime());
        const gapHours = gapMs / (1000 * 60 * 60);
        timeGapsHours.push(gapHours);
      }
    }

    if (timeGapsHours.length === 0) {
      return 24; // Fallback if no valid time gaps found
    }

    // Calculate 80th percentile of successful temporal gaps using simple-statistics
    const calculatedWindow = ss.quantile(timeGapsHours, 0.8);
    
    // Constrain to 12-72 hours per research bounds
    return Math.min(Math.max(calculatedWindow, 12), 72);
  }

  /**
   * Calculate data-driven association threshold by type
   * Research: Graph clustering and meaningful connection thresholds
   */
  private async getAssociationThresholdByType(associationType: string, memoryId: string): Promise<number> {
    // Get the persona ID from the memory
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { personaId: true }
    });
    
    if (!memory) {
      // Fallback to conservative threshold
      return 0.4;
    }

    // Query successful associations by type (both memories accessed = successful retrieval)
    const successfulAssociations = await this.prisma.memoryAssociation.findMany({
      where: {
        associationType,
        OR: [
          { memoryA: { persona: { id: memory.personaId }, accessCount: { gt: 0 } } },
          { memoryB: { persona: { id: memory.personaId }, accessCount: { gt: 0 } } }
        ]
      },
      select: { associationStrength: true },
      take: 100,
      orderBy: { associationStrength: 'asc' }
    });

    if (successfulAssociations.length === 0) {
      // Research-based fallbacks by association type
      const fallbackThresholds: Record<string, number> = {
        temporal: 0.2,     // Temporal connections valuable even if weak
        semantic: 0.4,     // Semantic similarity needs moderate strength
        emotional: 0.3,    // Emotional connections moderately valuable
        causal: 0.5,       // Causal relationships need strong evidence
        reference: 0.8,    // Reference/mention connections need high confidence
      };
      return fallbackThresholds[associationType] || 0.3;
    }

    // Use 25th percentile of successful association strengths using simple-statistics
    const strengths = successfulAssociations.map(a => a.associationStrength);
    const threshold = ss.quantile(strengths, 0.25);
    
    // Apply minimum threshold to avoid noise
    return Math.max(0.1, threshold);
  }

  /**
   * Calculate data-driven similarity bounds for meaningful associations
   * Research: Embedding similarity thresholds for semantic memory retrieval
   */
  private async calculateSimilarityBounds(memoryId: string): Promise<{ minDistance: number; maxDistance: number }> {
    // Get the persona ID from the memory
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { personaId: true }
    });
    
    if (!memory) {
      // Conservative fallback bounds
      return { minDistance: 0.1, maxDistance: 1.2 };
    }

    // Query semantic associations that led to successful retrievals
    const successfulSemanticAssocs = await this.prisma.memoryAssociation.findMany({
      where: {
        associationType: 'semantic',
        OR: [
          { memoryA: { persona: { id: memory.personaId }, accessCount: { gt: 0 } } },
          { memoryB: { persona: { id: memory.personaId }, accessCount: { gt: 0 } } }
        ]
      },
      include: {
        memoryA: { select: { embedding: true } },
        memoryB: { select: { embedding: true } }
      },
      take: 100
    });

    if (successfulSemanticAssocs.length === 0) {
      // Research-based fallback: typical embedding similarity ranges
      return { minDistance: 0.1, maxDistance: 1.2 };
    }

    // Use PostgreSQL to calculate distance bounds with percentiles
    const distanceQuery = await this.prisma.$queryRaw<{
      min_distance: number;
      max_distance: number;
      sample_count: number;
    }[]>`
      WITH semantic_distances AS (
        SELECT 
          (ma_mem.embedding <=> mb_mem.embedding) as distance
        FROM "MemoryAssociation" ma
        JOIN "Memory" ma_mem ON ma_mem.id = ma."memoryA"
        JOIN "Memory" mb_mem ON mb_mem.id = ma."memoryB"
        WHERE ma."associationType" = 'semantic'
          AND ma_mem."personaId" = ${memory.personaId}::uuid
          AND ma_mem."accessCount" > 0
          AND mb_mem."accessCount" > 0
          AND ma_mem.embedding IS NOT NULL
          AND mb_mem.embedding IS NOT NULL
          AND (ma_mem.embedding <=> mb_mem.embedding) > 0
        LIMIT 100
      )
      SELECT 
        PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY distance) as min_distance,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY distance) as max_distance,
        COUNT(*)::int as sample_count
      FROM semantic_distances
    `;

    if (distanceQuery.length === 0 || distanceQuery[0]?.sample_count === 0) {
      return { minDistance: 0.1, maxDistance: 1.2 };
    }

    const stats = distanceQuery[0];
    // Use 5th and 95th percentiles for similarity bounds 
    const minDistance = Math.max(0.05, stats?.min_distance || 0.1);
    const maxDistance = Math.min(1.5, stats?.max_distance || 1.2);
    
    return { minDistance, maxDistance };
  }
}
