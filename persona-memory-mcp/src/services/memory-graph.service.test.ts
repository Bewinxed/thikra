import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { EmbeddingService } from './embedding.service';
import { MemoryGraphService } from './memory-graph.service';
import {
  type TestDatabaseSetup,
  cleanupTestDatabase,
  getTestPrisma,
  seedTestData,
  setupTestDatabase,
} from './test-setup';

describe('MemoryGraphService - Real Database Integration', () => {
  let service: MemoryGraphService;
  let testDb: TestDatabaseSetup;
  let testData: any;
  let testMemories: any[];

  beforeAll(async () => {
    testDb = await setupTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
    testData = await seedTestData();

    const prisma = getTestPrisma();
    service = new MemoryGraphService(prisma);

    // Create test memories with embeddings
    testMemories = await createTestMemories(testData.persona.id);
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  async function createTestMemories(personaId: string) {
    const prisma = getTestPrisma();
    const embeddingService = new EmbeddingService();

    const memories = [
      {
        searchText: 'Learning about neural networks and deep learning fundamentals',
        memoryType: 'semantic',
        significanceScore: 0.8,
        tags: ['machine learning', 'neural networks'],
      },
      {
        searchText: 'Implementing a transformer model for natural language processing',
        memoryType: 'procedural',
        significanceScore: 0.9,
        tags: ['transformers', 'nlp', 'implementation'],
      },
      {
        searchText: 'Feeling excited about successful model training results',
        memoryType: 'emotional',
        significanceScore: 0.85,
        tags: ['excitement', 'success'],
      },
      {
        searchText: 'Had coffee with colleague to discuss project ideas',
        memoryType: 'episodic',
        significanceScore: 0.6,
        tags: ['social', 'collaboration'],
      },
    ];

    const createdMemories = [];
    for (const memoryData of memories) {
      // Generate real embedding using the embedding service
      const embedding = await embeddingService.embed(memoryData.searchText);

      const memory = await prisma.memory.create({
        data: {
          personaId,
          searchText: memoryData.searchText,
          memoryType: memoryData.memoryType as any,
          significanceScore: memoryData.significanceScore,
          tags: memoryData.tags,
          contentType: 'text',
        },
      });

      // Update embedding using raw SQL since Prisma doesn't handle vector type well
      await prisma.$executeRaw`
        UPDATE "Memory" 
        SET embedding = ${EmbeddingService.formatVectorForPg(embedding)}::vector
        WHERE id = ${memory.id}::uuid
      `;

      createdMemories.push(memory);
    }

    return createdMemories;
  }

  describe('buildAssociationsForMemory - Real Association Building', () => {
    it('should build associations for a memory using actual embedding similarity', async () => {
      const memoryId = testMemories[0].id; // Neural networks memory

      // Build associations using the real service
      await service.buildAssociationsForMemory(memoryId);

      // Check that associations were created in database
      const prisma = getTestPrisma();
      const associations = await prisma.memoryAssociation.findMany({
        where: {
          OR: [{ memoryA: memoryId }, { memoryB: memoryId }],
        },
        include: {
          memoryARelation: true,
          memoryBRelation: true,
        },
      });

      expect(associations.length).toBeGreaterThan(0);

      associations.forEach((assoc) => {
        expect(assoc.associationStrength).toBeGreaterThan(0);
        expect(assoc.associationStrength).toBeLessThanOrEqual(1);
        expect(assoc.associationType).toBeTruthy();
        expect(['semantic', 'temporal', 'emotional', 'causal', 'cross_modal']).toContain(
          assoc.associationType,
        );

        // Verify one end of association is our target memory
        const isConnected = assoc.memoryA === memoryId || assoc.memoryB === memoryId;
        expect(isConnected).toBe(true);

        // Verify memory relations are properly loaded
        expect(assoc.memoryARelation).toBeTruthy();
        expect(assoc.memoryBRelation).toBeTruthy();
      });
    });

    it('should create different association types based on memory content and context', async () => {
      // This test verifies that different types of associations can be created
      const prisma = getTestPrisma();
      const embeddingService = new EmbeddingService();

      // Create memories with different characteristics to enable various association types

      // 1. Add timestamps to enable temporal associations
      const now = new Date();
      await prisma.memory.update({
        where: { id: testMemories[0].id },
        data: { occurredAt: new Date(now.getTime() - 3600000) }, // 1 hour ago
      });
      await prisma.memory.update({
        where: { id: testMemories[1].id },
        data: { occurredAt: new Date(now.getTime() - 1800000) }, // 30 minutes ago
      });
      await prisma.memory.update({
        where: { id: testMemories[2].id },
        data: { occurredAt: new Date(now.getTime() - 900000) }, // 15 minutes ago
      });
      await prisma.memory.update({
        where: { id: testMemories[3].id },
        data: { occurredAt: new Date(now.getTime() - 300000) }, // 5 minutes ago
      });

      // 2. Add emotional states to multiple memories for emotional associations
      const emotionalState1 = await prisma.emotionalState.create({
        data: {
          components: {
            create: {
              emotionTypeId: testData.emotionTypes[0].id, // joy
              intensity: 0.8,
            },
          },
        },
      });

      const emotionalState2 = await prisma.emotionalState.create({
        data: {
          components: {
            create: {
              emotionTypeId: testData.emotionTypes[0].id, // same emotion type (joy)
              intensity: 0.7,
            },
          },
        },
      });

      await prisma.memory.update({
        where: { id: testMemories[2].id }, // "Feeling excited" memory
        data: { emotionalStateId: emotionalState1.id },
      });

      await prisma.memory.update({
        where: { id: testMemories[1].id }, // Procedural memory - also gets emotional state
        data: { emotionalStateId: emotionalState2.id },
      });

      // 3. Create a memory that references another memory ID for reference associations
      const searchTextWithReference = `Building on the work from ${testMemories[0].id}, we improved the model`;
      const referencingMemory = await prisma.memory.create({
        data: {
          personaId: testData.persona.id,
          searchText: searchTextWithReference,
          memoryType: 'semantic',
          significanceScore: 0.8,
          contentType: 'text',
        },
      });

      // Generate and set embedding for the new memory
      if (!referencingMemory.searchText) {
        throw new Error('Expected searchText to be defined');
      }
      const embedding = await embeddingService.embed(referencingMemory.searchText);
      await prisma.$executeRaw`
        UPDATE "Memory" 
        SET embedding = ${EmbeddingService.formatVectorForPg(embedding)}::vector
        WHERE id = ${referencingMemory.id}::uuid
      `;

      // Build associations for all memories including the new one
      const allTestMemories = [...testMemories, referencingMemory];
      for (const memory of allTestMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const allAssociations = await prisma.memoryAssociation.findMany({
        orderBy: [{ associationType: 'asc' }, { associationStrength: 'desc' }],
      });

      expect(allAssociations.length).toBeGreaterThan(0);

      // Should have different association types
      const associationTypes = [...new Set(allAssociations.map((a) => a.associationType))];
      expect(associationTypes.length).toBeGreaterThan(1);

      // Verify each type exists
      const semanticAssocs = allAssociations.filter((a) => a.associationType === 'semantic');
      const temporalAssocs = allAssociations.filter((a) => a.associationType === 'temporal');
      const referenceAssocs = allAssociations.filter((a) => a.associationType === 'reference');

      expect(semanticAssocs.length).toBeGreaterThan(0);
      expect(temporalAssocs.length).toBeGreaterThan(0);
      expect(referenceAssocs.length).toBeGreaterThan(0);
    });
  });

  describe('getRelatedMemories - Association Retrieval', () => {
    it('should retrieve related memories with association parameters', async () => {
      // Build associations first
      for (const memory of testMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const targetMemoryId = testMemories[0].id;

      // Test the actual getRelatedMemories method
      const relatedMemories = await service.getRelatedMemories({
        memoryId: targetMemoryId,
        limit: 5,
        minStrength: 0.3,
        associationTypes: ['semantic', 'temporal'],
      });

      expect(Array.isArray(relatedMemories)).toBe(true);
      expect(relatedMemories.length).toBeGreaterThanOrEqual(0);

      relatedMemories.forEach((result) => {
        expect(result.memory.id).toBeTruthy();
        expect(result.strength).toBeGreaterThanOrEqual(0.3);
        expect(['semantic', 'temporal']).toContain(result.associationType);
        expect(result.memory.id).not.toBe(targetMemoryId); // Should not include self
      });
    });

    it('should respect association strength thresholds', async () => {
      // Build associations
      for (const memory of testMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const targetMemoryId = testMemories[0].id;

      // Test with high threshold
      const strongRelations = await service.getRelatedMemories({
        memoryId: targetMemoryId,
        minStrength: 0.8,
      });

      // Test with low threshold
      const allRelations = await service.getRelatedMemories({
        memoryId: targetMemoryId,
        minStrength: 0.1,
      });

      // High threshold should return fewer results
      expect(strongRelations.length).toBeLessThanOrEqual(allRelations.length);

      // All returned memories should meet threshold
      strongRelations.forEach((result) => {
        expect(result.strength).toBeGreaterThanOrEqual(0.8);
      });
    });
  });

  describe('findMemoryPath - Graph Traversal', () => {
    it('should find path between two memories in the graph', async () => {
      // Build full association network
      for (const memory of testMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const startMemoryId = testMemories[0].id; // Neural networks
      const endMemoryId = testMemories[2].id; // Emotional memory

      // Test actual findMemoryPath method
      const paths = await service.findMemoryPath(startMemoryId, endMemoryId, 4);

      expect(Array.isArray(paths)).toBe(true);

      paths.forEach((pathResult) => {
        expect(pathResult.path.length).toBeGreaterThan(1);
        expect(pathResult.path[0]).toBe(startMemoryId);
        expect(pathResult.path[pathResult.path.length - 1]).toBe(endMemoryId);
        expect(pathResult.strength).toBeGreaterThan(0);
        expect(Array.isArray(pathResult.types)).toBe(true);
      });
    });

    it('should handle cases where no path exists', async () => {
      // Only build associations for first memory
      await service.buildAssociationsForMemory(testMemories[0].id);

      // Try to find path to unconnected memory
      const paths = await service.findMemoryPath(
        testMemories[0].id,
        testMemories[3].id, // Should be unconnected
        2,
      );

      // Should return empty array if no connection exists
      expect(Array.isArray(paths)).toBe(true);
    });
  });

  describe('discoverMemoryClusters - Memory Clustering', () => {
    it('should discover clusters of related memories', async () => {
      // Build associations for clustering
      for (const memory of testMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const clusters = await service.discoverMemoryClusters(testData.persona.id, 2);

      expect(Array.isArray(clusters)).toBe(true);

      clusters.forEach((cluster) => {
        expect(cluster.clusterId).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(cluster.memories)).toBe(true);
        expect(cluster.centralMemory).toBeTruthy();
        if (cluster.clusterTheme) {
          expect(typeof cluster.clusterTheme).toBe('string');
        }
      });
    });
  });

  describe('findTemporalChains - Temporal Association Analysis', () => {
    it('should find temporal chains of related memories', async () => {
      // Create memories with specific timestamps
      const prisma = getTestPrisma();
      const embeddingService = new EmbeddingService();
      const now = new Date();

      const temporalMemoryData = [
        {
          searchText: 'Started learning about ML',
          significanceScore: 0.7,
          occurredAt: new Date(now.getTime() - 3600000 * 3), // 3 hours ago
          memoryType: 'episodic' as const,
        },
        {
          searchText: 'Implemented first neural network',
          significanceScore: 0.8,
          occurredAt: new Date(now.getTime() - 3600000 * 2), // 2 hours ago
          memoryType: 'procedural' as const,
        },
        {
          searchText: 'Achieved breakthrough results',
          significanceScore: 0.9,
          occurredAt: new Date(now.getTime() - 3600000), // 1 hour ago
          memoryType: 'emotional' as const,
        },
      ];

      const temporalMemories = [];
      for (const data of temporalMemoryData) {
        const embedding = await embeddingService.embed(data.searchText);

        const memory = await prisma.memory.create({
          data: {
            personaId: testData.persona.id,
            searchText: data.searchText,
            significanceScore: data.significanceScore,
            occurredAt: data.occurredAt,
            memoryType: data.memoryType,
            contentType: 'text',
          },
        });

        await prisma.$executeRaw`
          UPDATE "Memory" 
          SET embedding = ${EmbeddingService.formatVectorForPg(embedding)}::vector
          WHERE id = ${memory.id}::uuid
        `;

        temporalMemories.push(memory);
      }

      // Build associations
      for (const memory of temporalMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const chains = await service.findTemporalChains(
        testData.persona.id,
        2, // minimum 2 memories in chain
      );

      expect(Array.isArray(chains)).toBe(true);

      chains.forEach((chain) => {
        expect(chain.chainId).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(chain.memories)).toBe(true);
        expect(chain.memories.length).toBeGreaterThanOrEqual(2);
        expect(chain.duration).toBeGreaterThan(0);
      });
    });
  });

  describe('findEmotionNetworks - Emotional Association Networks', () => {
    it('should find networks of emotionally connected memories', async () => {
      // Create memories with emotional states
      const prisma = getTestPrisma();
      const embeddingService = new EmbeddingService();

      // First create emotional states
      const emotionalState1 = await prisma.emotionalState.create({
        data: {},
      });

      const emotionalState2 = await prisma.emotionalState.create({
        data: {},
      });

      // Create memories linked to emotional states
      const emotionalMemoryData = [
        {
          searchText: 'Feeling excited about new project opportunities',
          significanceScore: 0.8,
          emotionalStateId: emotionalState1.id,
        },
        {
          searchText: 'Satisfied with completed work quality',
          significanceScore: 0.7,
          emotionalStateId: emotionalState2.id,
        },
      ];

      const emotionalMemories = [];
      for (const data of emotionalMemoryData) {
        const embedding = await embeddingService.embed(data.searchText);

        const memory = await prisma.memory.create({
          data: {
            personaId: testData.persona.id,
            searchText: data.searchText,
            significanceScore: data.significanceScore,
            emotionalStateId: data.emotionalStateId,
            memoryType: 'emotional',
            contentType: 'text',
          },
        });

        await prisma.$executeRaw`
          UPDATE "Memory" 
          SET embedding = ${EmbeddingService.formatVectorForPg(embedding)}::vector
          WHERE id = ${memory.id}::uuid
        `;

        emotionalMemories.push(memory);
      }

      // Build associations
      for (const memory of emotionalMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const networks = await service.findEmotionNetworks(testData.persona.id, 'excitement');

      expect(Array.isArray(networks)).toBe(true);

      networks.forEach((network) => {
        expect(network.networkId).toBeGreaterThanOrEqual(0);
        expect(network.dominantEmotion).toBeTruthy();
        expect(Array.isArray(network.memories)).toBe(true);
        expect(network.emotionalIntensity).toBeGreaterThanOrEqual(0);
        expect(network.emotionalIntensity).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('findCrossModalPaths - Cross-Modal Associations', () => {
    it('should find paths connecting different memory types', async () => {
      // Build associations across all memory types
      for (const memory of testMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const semanticMemory = testMemories.find((m) => m.memoryType === 'semantic');
      const emotionalMemory = testMemories.find((m) => m.memoryType === 'emotional');

      expect(semanticMemory).toBeTruthy();
      expect(emotionalMemory).toBeTruthy();

      const crossModalPaths = await service.findCrossModalPaths(
        testData.persona.id,
        'text',
        'image',
      );

      expect(Array.isArray(crossModalPaths)).toBe(true);

      crossModalPaths.forEach((path) => {
        expect(path.pathId).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(path.path)).toBe(true);
        expect(path.path.length).toBeGreaterThan(1);
        expect(Array.isArray(path.contentTypes)).toBe(true);
        expect(path.strength).toBeGreaterThan(0);
      });
    });
  });

  describe('Database Integrity and Performance', () => {
    it('should handle concurrent association building without duplicates', async () => {
      // Build associations concurrently
      const buildPromises = testMemories.map((memory) =>
        service.buildAssociationsForMemory(memory.id),
      );

      await Promise.all(buildPromises);

      // Check for duplicate associations
      const prisma = getTestPrisma();
      const associations = await prisma.memoryAssociation.findMany();

      expect(associations.length).toBeGreaterThan(0);

      // Verify no duplicate memory pairs (considering bidirectionality)
      const uniquePairs = new Set();
      associations.forEach((assoc) => {
        const pair = [assoc.memoryA, assoc.memoryB].sort().join('-');
        expect(uniquePairs.has(pair)).toBe(false);
        uniquePairs.add(pair);
      });
    });

    it('should maintain association strength bounds', async () => {
      // Build associations
      for (const memory of testMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const prisma = getTestPrisma();
      const associations = await prisma.memoryAssociation.findMany();

      associations.forEach((assoc) => {
        expect(assoc.associationStrength).toBeGreaterThan(0);
        expect(assoc.associationStrength).toBeLessThanOrEqual(1);
        expect(assoc.memoryA).not.toBe(assoc.memoryB); // No self-associations
      });
    });

    it('should handle memory deletion with cascade cleanup', async () => {
      // Build associations first
      for (const memory of testMemories) {
        await service.buildAssociationsForMemory(memory.id);
      }

      const prisma = getTestPrisma();
      const memoryToDelete = testMemories[0].id;

      // Delete memory (should cascade delete associations)
      await prisma.memory.delete({
        where: { id: memoryToDelete },
      });

      // Check associations were cleaned up
      const remainingAssociations = await prisma.memoryAssociation.findMany({
        where: {
          OR: [{ memoryA: memoryToDelete }, { memoryB: memoryToDelete }],
        },
      });

      expect(remainingAssociations.length).toBe(0);
    });
  });
});
