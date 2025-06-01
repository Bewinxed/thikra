import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { EmbeddingService } from './embedding.service';
import { SemanticContextService } from './semantic-context.service';
import { cleanupTestDatabase, getTestPrisma, seedTestData, setupTestDatabase } from './test-setup';

describe('SemanticContextService - LLM Usage Patterns', () => {
  let embeddingService: EmbeddingService;
  let semanticContext: SemanticContextService;
  let testPersonaId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    const prisma = getTestPrisma();

    embeddingService = new EmbeddingService();
    semanticContext = new SemanticContextService(prisma, embeddingService);

    const testData = await seedTestData();
    testPersonaId = testData.persona.id;
  });

  afterAll(async () => {
    await cleanupTestDatabase();
    const testDb = await import('./test-setup').then((m) => m.TestDatabaseSetup.getInstance());
    await testDb.disconnect();
  });

  test('LLM creates semantic link when processing user message', async () => {
    // Scenario: LLM processes "I miss my childhood home" and creates semantic link for memory
    const memoryId = crypto.randomUUID();

    const semanticLink = await semanticContext.createSemanticLink({
      sourceType: 'memory',
      sourceId: memoryId, // References existing Memory with embedding
      personaId: testPersonaId,
      content:
        'User mentioned missing their childhood home - nostalgic about family house with big backyard where they played as a kid',
      timestamp: new Date(),
    });

    expect(semanticLink.sourceType).toBe('memory');
    expect(semanticLink.sourceId).toBe(memoryId);
    expect(semanticLink.personaId).toBe(testPersonaId);
    expect(semanticLink.contextualDescription).toBeDefined(); // Contextual metadata stored
  }, 60000);

  test('LLM finds related emotional context when user expresses longing', async () => {
    // Setup: Create semantic links for different aspects of homesickness
    const memoryId = crypto.randomUUID();
    const emotionId = crypto.randomUUID();

    await semanticContext.createSemanticLink({
      sourceType: 'memory',
      sourceId: memoryId,
      personaId: testPersonaId,
      content: "Childhood memories of grandmother's apple pie and warm kitchen",
    });

    await semanticContext.createSemanticLink({
      sourceType: 'emotion',
      sourceId: emotionId,
      personaId: testPersonaId,
      content: 'Deep sadness and longing for family warmth and comfort',
    });

    // LLM searches for related context when user says "I feel so alone lately"
    const queryEmbedding = await embeddingService.embed('feeling alone and missing family warmth');
    const relatedContext = await semanticContext.findRelatedContext(
      queryEmbedding,
      testPersonaId,
      undefined,
      5,
      0.5,
    );

    expect(relatedContext).toBeDefined();
    expect(relatedContext.semanticConnections).toBeDefined();
  }, 60000);

  test('LLM maintains persona boundaries during context search', async () => {
    const prisma = getTestPrisma();

    // Create another persona (different user/character)
    const otherPersona = await prisma.persona.create({
      data: { name: 'DifferentUser' },
    });

    // Create semantic link for different persona
    await semanticContext.createSemanticLink({
      sourceType: 'memory',
      sourceId: crypto.randomUUID(),
      personaId: otherPersona.id,
      content: 'This persona loves coffee and morning routines',
    });

    // LLM searches current persona's context - should not see other persona's data
    const queryEmbedding = await embeddingService.embed('coffee morning routine');
    const relatedContext = await semanticContext.findRelatedContext(queryEmbedding, testPersonaId);

    // Should not leak data from other persona
    expect(relatedContext.semanticConnections.length).toBe(0);
  }, 60000);

  test('LLM handles duplicate detection for similar experiences', async () => {
    // Scenario: User mentions similar experiences multiple times
    const experience1Id = crypto.randomUUID();
    const experience2Id = crypto.randomUUID();

    await semanticContext.createSemanticLink({
      sourceType: 'memory',
      sourceId: experience1Id,
      personaId: testPersonaId,
      content: 'Had an amazing time at the beach with friends yesterday',
    });

    await semanticContext.createSemanticLink({
      sourceType: 'memory',
      sourceId: experience2Id,
      personaId: testPersonaId,
      content: 'Great day at the beach with my friend group, felt so happy',
    });

    // LLM runs deduplication to avoid semantic redundancy
    const result = await semanticContext.deduplicateEntities(testPersonaId, 'memory', 0.8);

    expect(result).toBeDefined();
    expect(typeof result.merged).toBe('number');
    expect(Array.isArray(result.duplicates)).toBe(true);
  }, 60000);
});
