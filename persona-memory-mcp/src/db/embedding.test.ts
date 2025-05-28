import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { type Embedding, EmbeddingService } from '../services/embedding.service';

config();

describe('Embedding Storage and Retrieval', () => {
  let prisma: PrismaClient;
  let embeddingService: EmbeddingService;
  let testPersona: { id: string; name: string };

  beforeAll(async () => {
    prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
    embeddingService = new EmbeddingService();

    // Create test persona
    testPersona = await prisma.persona.create({
      data: {
        name: 'Embedding Test Aria',
        protectedTraits: ['embedding_test'],
      },
    });
  });

  afterAll(async () => {
    await prisma.persona.delete({ where: { id: testPersona.id } });
    await prisma.$disconnect();
  });

  test('should store and retrieve embeddings correctly', async () => {
    // Generate real embedding
    const testText = 'Master taught me about vector databases and embeddings';
    const embedding = await embeddingService.embed(testText);

    // Validate embedding
    EmbeddingService.validateEmbedding(embedding);
    expect(embedding).toHaveLength(768);

    // Store memory with embedding using TO_VECTOR()
    const memoryId = crypto.randomUUID();
    const vectorString = EmbeddingService.formatVectorForPg(embedding);

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "Memory" (
          id,
          "personaId", 
          "memoryType",
          "searchText",
          embedding,
          "createdAt"
        )
        VALUES (
          ${memoryId}::uuid,
          ${testPersona.id}::uuid,
          'episodic'::"MemoryType",
          ${testText},
          ${vectorString}::vector,
          NOW()
        )
      `,
    );

    // Verify memory was stored
    const storedMemory = await prisma.memory.findUnique({
      where: { id: memoryId },
    });

    expect(storedMemory).toBeTruthy();
    expect(storedMemory?.personaId).toBe(testPersona.id);
    expect(storedMemory?.searchText).toBe(testText);
  });

  test('should perform similarity search correctly', async () => {
    // Create multiple memories with different embeddings
    const memories = [
      'Master and I worked on TypeScript together',
      'We debugged a complex algorithm',
      'I helped master with database design',
      'The weather was nice today', // Should be least similar
    ];

    const memoryIds: string[] = [];

    // Store all memories with embeddings
    for (const text of memories) {
      const embedding = await embeddingService.embed(text);
      const vectorString = EmbeddingService.formatVectorForPg(embedding);
      const memoryId = crypto.randomUUID();
      memoryIds.push(memoryId);

      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "Memory" (
            id,
            "personaId",
            "memoryType", 
            "searchText",
            embedding,
            "createdAt"
          )
          VALUES (
            ${memoryId}::uuid,
            ${testPersona.id}::uuid,
            'episodic'::"MemoryType",
            ${text},
            ${vectorString}::vector,
            NOW()
          )
        `,
      );
    }

    // Search for similar memories to "programming with master"
    const queryText = 'coding and programming with master';
    const queryEmbedding = await embeddingService.embed(queryText);
    const queryVectorString = EmbeddingService.formatVectorForPg(queryEmbedding);

    const results = await prisma.$queryRaw<
      Array<{ id: string; searchText: string; distance: number }>
    >(
      Prisma.sql`
        SELECT 
          id,
          "searchText",
          embedding <-> ${queryVectorString}::vector as distance
        FROM "Memory"
        WHERE "personaId" = ${testPersona.id}::uuid
        ORDER BY distance ASC
        LIMIT 5
      `,
    );

    expect(results.length).toBeGreaterThan(0);

    // Programming-related memories should be more similar (lower distance)
    const programmingResults = results.filter(
      (r) =>
        r.searchText.includes('TypeScript') ||
        r.searchText.includes('algorithm') ||
        r.searchText.includes('database'),
    );

    const weatherResult = results.find((r) => r.searchText.includes('weather'));

    if (programmingResults.length > 0 && weatherResult) {
      // Programming memories should be more similar (lower distance) than weather
      expect(programmingResults[0]?.distance).toBeLessThan(weatherResult.distance);
    }

    // Results should be ordered by similarity (ascending distance)
    for (let i = 1; i < results.length; i++) {
      expect(results[i]?.distance).toBeGreaterThanOrEqual(results[i - 1]?.distance ?? 0);
    }
  });

  test('should handle vector formatting correctly', async () => {
    // Test vector formatting
    const mockEmbedding: Embedding = [0.1, 0.2, 0.3, -0.1, -0.2];
    const formatted = EmbeddingService.formatVectorForPg(mockEmbedding);

    expect(formatted).toBe('[0.1,0.2,0.3,-0.1,-0.2]');
  });

  test('should validate embedding dimensions', async () => {
    // Valid embedding should not throw
    const validEmbedding: Embedding = new Array(768).fill(0.5);
    expect(() => EmbeddingService.validateEmbedding(validEmbedding)).not.toThrow();

    // Invalid embedding should throw
    const invalidEmbedding: Embedding = new Array(100).fill(0.5);
    expect(() => EmbeddingService.validateEmbedding(invalidEmbedding)).toThrow(
      'Invalid embedding dimensions: expected 768, got 100',
    );
  });
});
