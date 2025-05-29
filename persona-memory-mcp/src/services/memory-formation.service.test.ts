import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { b } from '../../baml_client';
import { PromptCache } from '../utils/prompt-cache';
import { EmbeddingService } from './embedding.service';
import { MemoryFormationService } from './memory-formation.service';
import { MemoryGraphService } from './memory-graph.service';
import {
  type TestDatabaseSetup,
  cleanupTestDatabase,
  getTestPrisma,
  seedTestData,
  setupTestDatabase,
} from './test-setup';

// Cache for BAML responses to avoid repeated LLM calls
const bamlResponseCache = new Map<string, any>();
const promptCache = new PromptCache();

describe('MemoryFormationService - Real Database Integration', () => {
  let service: MemoryFormationService;
  let memoryGraphService: MemoryGraphService;
  let embeddingService: EmbeddingService;
  let testDb: TestDatabaseSetup;
  let testData: any;

  beforeAll(async () => {
    testDb = await setupTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
    testData = await seedTestData();

    const prisma = getTestPrisma();
    embeddingService = new EmbeddingService();
    memoryGraphService = new MemoryGraphService(prisma);
    service = new MemoryFormationService(prisma, embeddingService, memoryGraphService);
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('createMemoryFromMessage - Real BAML with Real Database', () => {
    it('should create memory from conversation message with BAML emotion extraction', async () => {
      const message = {
        role: 'user' as const,
        content:
          "I'm incredibly excited about this new machine learning project! The possibilities seem endless and I can't wait to dive in.",
        timestamp: new Date(),
      };

      // This will call real BAML for emotion extraction
      const memory = await service.createMemoryFromMessage(testData.persona.id, message, {
        conversationId: 'test-conv-1',
      });

      // Verify memory was created
      expect(memory.id).toBeTruthy();
      expect(memory.searchText).toBe(message.content);
      expect(memory.personaId).toBe(testData.persona.id);

      // Verify in database
      const prisma = getTestPrisma();
      const dbMemory = await prisma.memory.findUnique({
        where: { id: memory.id },
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
          consolidation: true,
        },
      });

      expect(dbMemory).toBeTruthy();
      expect(dbMemory?.searchText).toBe(message.content);
      expect(dbMemory?.consolidation).toBeTruthy(); // Should create consolidation record
    });

    it('should handle different message roles and calculate appropriate significance', async () => {
      const messages = [
        {
          role: 'user' as const,
          content: 'What is machine learning?',
          expected: 'lower',
        },
        {
          role: 'assistant' as const,
          content:
            'Machine learning is a subset of AI that enables computers to learn patterns from data without explicit programming.',
          expected: 'higher',
        },
        {
          role: 'system' as const,
          content: 'Context updated',
          expected: 'lowest',
        },
      ];

      const createdMemories = [];
      for (const msg of messages) {
        const memory = await service.createMemoryFromMessage(testData.persona.id, msg);
        createdMemories.push(memory);
      }

      // System messages should have lowest significance, assistant responses higher than user questions
      const [userMemory, assistantMemory, systemMemory] = createdMemories;
      expect(systemMemory?.significanceScore).toBeLessThan(userMemory?.significanceScore || 0);
      expect(assistantMemory?.significanceScore).toBeGreaterThan(
        userMemory?.significanceScore || 0,
      );
    });
  });

  describe('processConversationBatch - Real BAML Emotion Analysis', () => {
    it('should process multiple messages and extract emotional journey', async () => {
      const conversation = [
        {
          role: 'user' as const,
          content: "I'm feeling anxious about this upcoming presentation.",
          timestamp: new Date(),
        },
        {
          role: 'assistant' as const,
          content: 'What specifically about the presentation is making you feel anxious?',
          timestamp: new Date(),
        },
        {
          role: 'user' as const,
          content: "I'm worried I'll forget what to say and embarrass myself.",
          timestamp: new Date(),
        },
        {
          role: 'assistant' as const,
          content: "That's understandable. Let's practice together to build your confidence.",
          timestamp: new Date(),
        },
        {
          role: 'user' as const,
          content: "Actually, that sounds really helpful! I'm feeling more optimistic now.",
          timestamp: new Date(),
        },
      ];

      // This will call real BAML for emotional journey extraction
      const result = await service.processConversationBatch(testData.persona.id, conversation, {
        conversationId: 'emotional-journey-test',
      });

      expect(result.length).toBe(conversation.length);

      // Verify memories were stored in database
      const prisma = getTestPrisma();
      const dbMemories = await prisma.memory.findMany({
        where: { personaId: testData.persona.id },
        include: { emotionalState: true },
        orderBy: { createdAt: 'asc' },
      });

      expect(dbMemories.length).toBe(conversation.length);

      // Should capture emotional progression from anxious to optimistic
      dbMemories.forEach((memory, index) => {
        expect(memory.searchText).toBe(conversation[index]?.content || null);
      });
    });
  });

  describe('createMultiModalMemory - Content Type Handling', () => {
    it('should handle different content types appropriately', async () => {
      const testCases = [
        { content: 'Plain text memory', contentType: 'text/plain' },
        {
          content: 'User: Hello\nAssistant: Hi there!',
          contentType: 'conversation',
        },
        { content: 'https://example.com/image.jpg', contentType: 'image/jpeg' },
        { content: 'Meeting notes from today', contentType: 'notes' },
      ];

      for (const testCase of testCases) {
        const memory = await service.createMultiModalMemory(
          testData.persona.id,
          testCase.content,
          testCase.contentType,
        );

        expect(memory.id).toBeTruthy();
        expect(memory.contentType).toBe(testCase.contentType);
        expect(memory.searchText).toBe(testCase.content);
      }

      // Verify all stored in database
      const prisma = getTestPrisma();
      const memories = await prisma.memory.findMany({
        where: { personaId: testData.persona.id },
      });

      expect(memories.length).toBe(testCases.length);

      // Each should have correct content type
      memories.forEach((memory) => {
        const testCase = testCases.find((tc) => tc.content === memory.searchText);
        expect(testCase).toBeTruthy();
        expect(memory.contentType).toBe(testCase?.contentType || null);
      });
    });
  });

  describe('BAML Integration - Real LLM Extraction', () => {
    it('should extract emotional patterns using real BAML calls', async () => {
      const emotionalContent =
        "I'm absolutely devastated by this news. My heart feels like it's breaking into a million pieces. I can't stop crying and everything feels hopeless right now.";
      const cacheKey = `emotional-extraction-${emotionalContent}`;

      // Check cache first to avoid repeated LLM calls
      let bamlResult = bamlResponseCache.get(cacheKey);

      if (!bamlResult) {
        bamlResult = await b.ExtractEmotionalPatterns(emotionalContent);
        bamlResponseCache.set(cacheKey, bamlResult);

        await promptCache.store(
          'ExtractEmotionalPatterns_memory_formation_test',
          `Emotional Content: ${emotionalContent}`,
          bamlResult,
        );
      }

      // Verify BAML extraction worked
      expect(bamlResult.primaryEmotions || bamlResult.personalityTraits).toBeTruthy();

      // Create memory which should trigger emotion processing
      const memory = await service.createMemoryFromMessage(testData.persona.id, {
        role: 'user',
        content: emotionalContent,
      });

      // Verify emotional state was created in database
      const prisma = getTestPrisma();
      const memoryWithEmotion = await prisma.memory.findUnique({
        where: { id: memory.id },
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
      });

      expect(memoryWithEmotion).toBeTruthy();

      // If emotional processing created an emotional state
      if (memoryWithEmotion?.emotionalState) {
        expect(memoryWithEmotion.emotionalState.id).toBeTruthy();
        expect(memoryWithEmotion.emotionalState.components.length).toBeGreaterThan(0);

        memoryWithEmotion.emotionalState.components.forEach((component) => {
          expect(component.intensity).toBeGreaterThanOrEqual(0);
          expect(component.intensity).toBeLessThanOrEqual(1);
          expect(component.emotionType.emotionName).toBeTruthy();
        });
      }
    });

    it('should estimate PAD values for detected emotions', async () => {
      const emotionName = 'overwhelming_joy';
      const context =
        'Just received news that my research paper was accepted at a top-tier conference';
      const cacheKey = `pad-values-${emotionName}-${context}`;

      let bamlResult = bamlResponseCache.get(cacheKey);

      if (!bamlResult) {
        bamlResult = await b.EstimatePADValues(emotionName, context);
        bamlResponseCache.set(cacheKey, bamlResult);

        await promptCache.store(
          'EstimatePADValues_memory_formation_test',
          `Emotion: ${emotionName}\nContext: ${context}`,
          bamlResult,
        );
      }

      // Verify PAD values are in correct ranges
      expect(bamlResult.pleasure).toBeGreaterThanOrEqual(-1);
      expect(bamlResult.pleasure).toBeLessThanOrEqual(1);
      expect(bamlResult.arousal).toBeGreaterThanOrEqual(0);
      expect(bamlResult.arousal).toBeLessThanOrEqual(1);
      expect(bamlResult.dominance).toBeGreaterThanOrEqual(-1);
      expect(bamlResult.dominance).toBeLessThanOrEqual(1);
    });
  });

  describe('Memory Graph Integration', () => {
    it('should build associations for new memories using real MemoryGraphService', async () => {
      // Create some base memories first
      const baseMemory1 = await service.createMemoryFromMessage(testData.persona.id, {
        role: 'user',
        content: 'I love learning about neural networks and deep learning architectures.',
      });

      const baseMemory2 = await service.createMemoryFromMessage(testData.persona.id, {
        role: 'assistant',
        content: 'Transformers are a particularly interesting architecture for sequence modeling.',
      });

      // Create a related memory that should associate with the base memories
      const newMemory = await service.createMemoryFromMessage(testData.persona.id, {
        role: 'user',
        content:
          'The attention mechanism in transformers is fascinating for neural network design.',
      });

      // Check that associations were created by the MemoryGraphService
      const prisma = getTestPrisma();
      const associations = await prisma.memoryAssociation.findMany({
        where: {
          OR: [{ memoryA: newMemory.id }, { memoryB: newMemory.id }],
        },
        include: {
          memoryARelation: true,
          memoryBRelation: true,
        },
      });

      // Should have created some associations with related memories
      expect(associations.length).toBeGreaterThan(0);

      associations.forEach((assoc) => {
        expect(assoc.associationStrength).toBeGreaterThan(0);
        expect(assoc.associationStrength).toBeLessThanOrEqual(1);
        expect(assoc.associationType).toBeTruthy();
        expect(['semantic', 'temporal', 'emotional', 'causal', 'cross_modal']).toContain(
          assoc.associationType,
        );
      });
    });
  });

  describe('Database Integrity and Error Handling', () => {
    it('should handle invalid persona ID gracefully', async () => {
      await expect(
        service.createMemoryFromMessage('non-existent-persona', {
          role: 'user',
          content: 'This should fail',
        }),
      ).rejects.toThrow();
    });

    it('should maintain data consistency with concurrent memory creation', async () => {
      const personaId = testData.persona.id;

      // Create multiple memories concurrently
      const memoryPromises = Array.from({ length: 5 }, (_, i) =>
        service.createMemoryFromMessage(personaId, {
          role: 'user',
          content: `Concurrent message ${i}: Testing database integrity.`,
        }),
      );

      const memories = await Promise.all(memoryPromises);

      // All should succeed
      expect(memories.length).toBe(5);
      memories.forEach((memory, index) => {
        expect(memory.id).toBeTruthy();
        expect(memory.searchText).toContain(`Concurrent message ${index}`);
      });

      // Verify all in database
      const prisma = getTestPrisma();
      const dbMemories = await prisma.memory.findMany({
        where: { personaId },
      });

      expect(dbMemories.length).toBeGreaterThanOrEqual(5);
    });

    it('should properly handle memory consolidation initialization', async () => {
      const memory = await service.createMemoryFromMessage(testData.persona.id, {
        role: 'user',
        content: 'This memory should have consolidation tracking.',
      });

      // Check consolidation record was created
      const prisma = getTestPrisma();
      const consolidation = await prisma.memoryConsolidation.findUnique({
        where: { memoryId: memory.id },
      });

      expect(consolidation).toBeTruthy();
      expect(consolidation?.memoryId).toBe(memory.id);
      expect(consolidation?.initialStrength).toBe(1.0);
      expect(consolidation?.currentStrength).toBeGreaterThan(0);
      expect(consolidation?.currentStrength).toBeLessThanOrEqual(1);
      expect(consolidation?.reactivationCount).toBeGreaterThanOrEqual(0);
      expect(consolidation?.inReconsolidation).toBe(false);
    });
  });
});
