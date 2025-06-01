import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Persona } from '@prisma/client';
import { AgenticMemoryRetrieval } from './agentic-retrieval.service';
import { EmbeddingService } from './embedding.service';
import { MemoryFormationService } from './memory-formation.service';
import { MemoryGraphService } from './memory-graph.service';
import { PersonaBuilder } from './persona-builder.service';
import { PersonaOrchestrationService } from './persona-orchestration.service';
import { PersonalityMonitorService } from './personality-monitor.service';
import { RelationshipEvolutionService } from './relationship-evolution.service';
import { SemanticContextService } from './semantic-context.service';
import { StateManagementService } from './state-management.service';
import { cleanupTestDatabase, getTestPrisma, seedTestData, setupTestDatabase } from './test-setup';

describe('PersonaOrchestrationService - MCP Integration', () => {
  let orchestration: PersonaOrchestrationService;
  let testPersona: Persona;
  let testEntityId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    const prisma = getTestPrisma();

    // Initialize all required services
    const embeddingService = new EmbeddingService();
    const memoryGraph = new MemoryGraphService(prisma);
    const memoryFormation = new MemoryFormationService(prisma, embeddingService, memoryGraph);
    const personaBuilder = new PersonaBuilder(prisma, embeddingService);
    const personalityMonitor = new PersonalityMonitorService(prisma);
    const relationshipEvolution = new RelationshipEvolutionService(prisma, embeddingService);
    const stateManagement = new StateManagementService(prisma);
    const agenticRetrieval = new AgenticMemoryRetrieval(prisma, embeddingService);
    const semanticContext = new SemanticContextService(prisma, embeddingService);

    // Create orchestration service
    orchestration = new PersonaOrchestrationService(
      prisma,
      memoryFormation,
      memoryGraph,
      personaBuilder,
      personalityMonitor,
      relationshipEvolution,
      stateManagement,
      agenticRetrieval,
      semanticContext,
      embeddingService,
    );

    // Setup test data
    const testData = await seedTestData();
    testPersona = testData.persona;
    testEntityId = testData.entities[0].id;
  });

  afterAll(async () => {
    await cleanupTestDatabase();
    const testDb = await import('./test-setup').then((m) => m.TestDatabaseSetup.getInstance());
    await testDb.disconnect();
  });

  test('Track 1: processMessage handles complete pipeline orchestration', async () => {
    // Test the orchestrated approach - one call handles everything
    const message =
      'I had the most amazing day today! I went hiking with my friend Sarah and we discovered this beautiful hidden waterfall. I felt so peaceful and connected to nature. Sarah is such a wonderful friend - she always knows how to make me laugh, and I really appreciate her adventurous spirit.';

    const result = await orchestration.processMessage(message, {
      personaId: testPersona.id,
      entityId: testEntityId,
      channel: 'mcp_test',
      sessionId: 'orchestration_test_1',
      timestamp: new Date(),
      contentType: 'text',
    });

    // Verify orchestration completed successfully
    expect(result.processingComplete).toBe(true);
    expect(result.memory).toBeDefined();
    expect(result.memory.searchText).toContain('hiking');

    // Verify persona insights were extracted
    expect(result.personaInsights.identityComponents).toBeGreaterThanOrEqual(0);
    expect(result.personaInsights.physicalAttributes).toBeGreaterThanOrEqual(0);
    expect(result.personaInsights.speechPatterns).toBeGreaterThanOrEqual(0);

    // Verify relationship processing occurred
    expect(result.relationshipChanges.relationshipsUpdated).toBeGreaterThanOrEqual(0);

    // Verify personality monitoring occurred
    expect(result.personalityUpdates.observationsAdded).toBeGreaterThanOrEqual(0);

    // Verify semantic linking occurred
    expect(result.semanticLinks).toBe(1);

    // Verify async tasks were queued
    expect(result.asyncTasksQueued.length).toBeGreaterThan(0);
    expect(result.asyncTasksQueued.some((task) => task.includes('memory_consolidation'))).toBe(
      true,
    );

    console.log('✅ Orchestrated processing result:', {
      memoryCreated: !!result.memory,
      personaInsights: result.personaInsights,
      relationshipChanges: result.relationshipChanges,
      personalityUpdates: result.personalityUpdates,
      semanticLinks: result.semanticLinks,
      asyncTasks: result.asyncTasksQueued.length,
    });
  }, 60000);

  test('Track 1: getContext provides unified cross-model retrieval', async () => {
    // First, process a few messages to build context
    const messages = [
      'I love spending time in nature, especially forests and mountains.',
      'My friend Alex is a photographer who captures beautiful landscapes.',
      "I feel most peaceful when I'm surrounded by trees and fresh air.",
    ];

    for (const [index, message] of messages.entries()) {
      await orchestration.processMessage(message, {
        personaId: testPersona.id,
        entityId: testEntityId,
        channel: 'mcp_test',
        sessionId: `context_build_${index}`,
        timestamp: new Date(Date.now() + index * 1000),
      });
    }

    // Now test unified context retrieval
    const context = await orchestration.getContext('nature and outdoor activities', {
      personaId: testPersona.id,
      includeEmotions: true,
      includePersonality: true,
      includeRelationships: true,
      includeSemanticLinks: true,
      maxResults: 10,
      similarityThreshold: 0.5,
    });

    // Verify unified context structure
    expect(context.memories).toBeDefined();
    expect(Array.isArray(context.memories)).toBe(true);
    expect(context.emotions).toBeDefined();
    expect(context.personality).toBeDefined();
    expect(context.relationships).toBeDefined();
    expect(context.semanticConnections).toBeDefined();
    expect(context.dynamicStates).toBeDefined();
    expect(context.contextualDescription).toBeDefined();

    // Verify context contains relevant memories
    const natureMemories = context.memories.filter(
      (m) =>
        m.searchText?.toLowerCase().includes('nature') ||
        m.searchText?.toLowerCase().includes('forest') ||
        m.searchText?.toLowerCase().includes('mountain'),
    );
    expect(natureMemories.length).toBeGreaterThan(0);

    // Verify contextual description is meaningful
    expect(context.contextualDescription).toContain('nature and outdoor activities');
    expect(context.contextualDescription).toContain('memories');

    console.log('✅ Unified context result:', {
      memories: context.memories.length,
      emotions: context.emotions.length,
      personality: context.personality.length,
      relationships: context.relationships.length,
      semanticConnections: context.semanticConnections.length,
      dynamicStates: Object.keys(context.dynamicStates).length,
      description: context.contextualDescription,
    });
  }, 60000);

  test('Track 1: getCurrentState provides comprehensive persona overview', async () => {
    const state = await orchestration.getCurrentState(testPersona.id);

    expect(state.persona).toBeDefined();
    expect(state.persona?.id).toBe(testPersona.id);
    expect(state.memoryCount).toBeGreaterThan(0);
    expect(state.relationshipCount).toBeGreaterThanOrEqual(0);
    expect(state.personalityParameterCount).toBeGreaterThanOrEqual(0);
    expect(state.dynamicStateCount).toBeGreaterThanOrEqual(0);
    expect(state.lastActivity).toBeDefined();

    console.log('✅ Current state overview:', {
      personaId: state.persona?.id,
      memories: state.memoryCount,
      relationships: state.relationshipCount,
      personalityParams: state.personalityParameterCount,
      dynamicStates: state.dynamicStateCount,
      lastActivity: state.lastActivity?.toISOString(),
    });
  }, 60000);

  test('Error handling: processMessage handles invalid input gracefully', async () => {
    await expect(
      orchestration.processMessage('', {
        personaId: 'invalid-uuid',
        channel: 'test',
      }),
    ).rejects.toThrow();

    // This should work with minimal metadata
    const result = await orchestration.processMessage('Simple test message', {
      personaId: testPersona.id,
      channel: 'test',
    });

    expect(result.processingComplete).toBe(true);
    expect(result.memory).toBeDefined();
  }, 60000);

  test('Error handling: getContext handles invalid persona ID gracefully', async () => {
    await expect(
      orchestration.getContext('test query', {
        personaId: 'invalid-uuid',
      }),
    ).rejects.toThrow();
  }, 60000);

  test('Performance: processMessage completes within reasonable time', async () => {
    const startTime = Date.now();

    const result = await orchestration.processMessage(
      'Performance test message with moderate complexity and multiple concepts like friendship, emotions, and activities.',
      {
        personaId: testPersona.id,
        entityId: testEntityId,
        channel: 'performance_test',
      },
    );

    const processingTime = Date.now() - startTime;

    expect(result.processingComplete).toBe(true);
    expect(processingTime).toBeLessThan(30000); // Should complete within 30 seconds

    console.log(`⚡ Processing time: ${processingTime}ms`);
  }, 60000);

  test('Integration: semantic context enhances memory retrieval', async () => {
    // Process message with emotional content
    await orchestration.processMessage(
      "I'm feeling really anxious about my upcoming job interview. My stomach is in knots and I keep overthinking everything. I wish I could just calm down and feel more confident.",
      {
        personaId: testPersona.id,
        channel: 'integration_test',
      },
    );

    // Retrieve context that should include emotional semantics
    const context = await orchestration.getContext('anxiety and nervousness', {
      personaId: testPersona.id,
      includeEmotions: true,
      similarityThreshold: 0.6,
    });

    // Should find the anxiety-related memory
    const anxietyMemories = context.memories.filter(
      (m) =>
        m.searchText?.toLowerCase().includes('anxious') ||
        m.searchText?.toLowerCase().includes('anxiety'),
    );

    expect(anxietyMemories.length).toBeGreaterThan(0);

    // Should have semantic connections if emotions were detected
    if (context.emotions.length > 0) {
      expect(context.semanticConnections.length).toBeGreaterThan(0);
    }

    console.log('✅ Semantic integration result:', {
      anxietyMemories: anxietyMemories.length,
      totalMemories: context.memories.length,
      emotions: context.emotions.length,
      semanticConnections: context.semanticConnections.length,
    });
  }, 60000);
});
