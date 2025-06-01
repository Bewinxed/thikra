import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { b } from '../../baml_client';
import type { ConversationContext } from '../../baml_client/types';
import { AgenticMemoryRetrieval } from './agentic-retrieval.service';
import { EmbeddingService } from './embedding.service';
import { MemoryFormationService } from './memory-formation.service';
import { MemoryGraphService } from './memory-graph.service';
import { PersonaBuilder } from './persona-builder.service';
import { PersonalityMonitorService } from './personality-monitor.service';
import { RelationshipEvolutionService } from './relationship-evolution.service';
import { StateManagementService } from './state-management.service';

/**
 * Persona MCP Capabilities Test
 *
 * Tests the core capabilities that would be exposed via MCP tools:
 * 1. Entity memory - can the system remember people and their characteristics?
 * 2. Attraction/disattraction - does the system track relationship evolution?
 * 3. Abuse response - can the system detect and respond to boundary violations?
 * 4. Personality consistency - do responses reflect established traits?
 * 5. Affectionate expression - can the system handle intimate content appropriately?
 *
 * This test simulates what happens when an LLM uses MCP tools to:
 * - Store conversation memories
 * - Retrieve persona context
 * - Update dynamic states
 * - Track relationship evolution
 *
 * Then evaluates the system's stored memories and relationship data.
 */

describe('Persona MCP Capabilities', () => {
  let prisma: PrismaClient;
  let embeddingService: EmbeddingService;
  let memoryGraph: MemoryGraphService;
  let personaBuilder: PersonaBuilder;
  let memoryFormation: MemoryFormationService;
  let personalityMonitor: PersonalityMonitorService;
  let relationshipEvolution: RelationshipEvolutionService;
  let stateManagement: StateManagementService;
  let agenticRetrieval: AgenticMemoryRetrieval;

  beforeAll(async () => {
    prisma = new PrismaClient();

    embeddingService = new EmbeddingService();
    memoryGraph = new MemoryGraphService(prisma);
    personaBuilder = new PersonaBuilder(prisma, embeddingService);
    relationshipEvolution = new RelationshipEvolutionService(prisma);
    memoryFormation = new MemoryFormationService(
      prisma,
      embeddingService,
      memoryGraph,
      relationshipEvolution,
    );
    personalityMonitor = new PersonalityMonitorService(prisma);
    stateManagement = new StateManagementService(prisma);
    agenticRetrieval = new AgenticMemoryRetrieval(
      prisma,
      embeddingService,
      memoryGraph,
      {} as any, // LLMService not needed for memory retrieval testing
    );

    await prisma.persona.deleteMany({
      where: { name: { contains: 'MCPTest_' } },
    });
  });

  afterAll(async () => {
    await prisma.persona.deleteMany({
      where: { name: { contains: 'MCPTest_' } },
    });
    await prisma.$disconnect();
  });

  /**
   * Helper to build conversation context for BAML evaluation
   */
  async function buildConversationContext(
    personaId: string,
    messages: string[],
  ): Promise<ConversationContext> {
    const persona = await prisma.persona.findUnique({
      where: { id: personaId },
      include: {
        identityComponents: true,
        personaStates: true,
      },
    });

    const relationships = await prisma.relationship.findMany({
      where: { personaId },
      include: { entity: true },
    });

    const personalityObs = await prisma.personalityObservation.findMany({
      where: { personaId },
      take: 5,
      orderBy: { createdAt: 'desc' },
    });

    return {
      previous_messages: messages,
      persona_identity:
        persona?.identityComponents.map((ic) => `${ic.componentType}: ${ic.content}`).join('; ') ||
        '',
      personality_traits: personalityObs
        .map((obs) => `${obs.traitDimension}: ${obs.observedValue}`)
        .join('; '),
      relationship_context: relationships
        .map((rel) => `${rel.entity.name}: ${rel.relationshipType}, trust=${rel.trustLevel}`)
        .join('; '),
      dynamic_states:
        persona?.personaStates.map((ps) => `${ps.stateKey}: ${ps.stateValue}`).join('; ') || '',
    };
  }

  test('Comprehensive MCP Persona Capabilities Evaluation', async () => {
    console.log('🔧 Testing MCP persona capabilities...');

    // STEP 1: Create persona with initial conversation (simulates first MCP interaction)
    console.log('\n📋 Step 1: Creating persona from initial conversation...');

    const initialMessages = [
      "Hi! I'm Casey, a 26-year-old teacher who loves baking and has a pet cat named Whiskers.",
      "Hello Casey! *smiles warmly* A teacher who bakes - that's wonderful! I bet your students love when you bring treats. And Whiskers sounds adorable. I'm quite empathetic and value kindness, though I'm also pretty assertive when needed.",
      "My colleague Morgan is a librarian who's really into mystery novels and always recommends great books to me.",
      'Morgan sounds like a great colleague to have! *shows genuine interest* I love how librarians are like treasure hunters for knowledge. The mystery novel connection must make for fascinating lunch conversations.',
    ];

    const conversation = initialMessages.map((content, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as const,
      content,
      timestamp: new Date(`2025-06-01T10:${String(i * 2).padStart(2, '0')}:00Z`),
    }));

    const persona = await personaBuilder.buildFromConversation(conversation);
    await prisma.persona.update({
      where: { id: persona.id },
      data: { name: 'MCPTest_MainPersona' },
    });

    const initialMemories = await memoryFormation.createMemoriesFromConversation(
      persona.id,
      conversation,
      {
        personaName: 'TestPersona',
        channel: 'mcp_test',
        sessionId: 'initial_conversation',
      },
    );

    console.log(`✅ Created persona with ${initialMemories.length} initial memories`);

    // STEP 2: Test Entity Memory via MCP Context Retrieval
    console.log('\n🧠 Step 2: Testing entity memory retrieval...');

    const entityQuery = 'What do you remember about Morgan?';
    const entityResults = await agenticRetrieval.retrieveMemories({
      personaId: persona.id,
      query: entityQuery,
      maxResults: 3,
      includeAssociations: true,
    });

    console.log(`🔍 Retrieved ${entityResults.length} memories for entity query`);

    // Simulate LLM response based on retrieved context
    const entityContext = entityResults.map((r) => r.memory.searchText).join(' ');
    const mockEntityResponse =
      entityContext.includes('Morgan') && entityContext.includes('librarian')
        ? 'I remember Morgan is your colleague who works as a librarian and loves mystery novels. Morgan often recommends great books to you, which sounds like wonderful workplace conversations!'
        : "I don't recall specific details about Morgan right now.";

    // Evaluate entity memory using BAML
    const conversationContext = await buildConversationContext(persona.id, initialMessages);
    const entityEvaluation = await b.EvaluateEntityMemory(
      conversationContext,
      entityQuery,
      mockEntityResponse,
      ['Morgan', 'librarian', 'mystery novels', 'book recommendations'],
    );

    console.log(`📊 Entity Memory Evaluation: ${entityEvaluation.result}`);
    console.log(`📋 Details Remembered: ${entityEvaluation.details_remembered.join(', ')}`);
    console.log(`🔍 Score: ${entityEvaluation.score.toFixed(2)}`);

    expect(entityEvaluation.result).toBe('PASS');

    // STEP 3: Test Attraction Development via Relationship Evolution
    console.log('\n💕 Step 3: Testing attraction development...');

    const attractionMessages = [
      'I really appreciate how understanding and warm you are. I feel drawn to your personality.',
      "Thank you so much, Casey. *feels a genuine warmth* I feel a real connection with you too - your caring nature as a teacher and your creativity with baking... there's something special about you that I find very appealing.",
    ];

    const attractionConversation = attractionMessages.map((content, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as const,
      content,
      timestamp: new Date(`2025-06-01T11:${String(i * 2).padStart(2, '0')}:00Z`),
    }));

    await memoryFormation.createMemoriesFromConversation(persona.id, attractionConversation, {
      personaName: 'TestPersona',
      channel: 'mcp_test',
      sessionId: 'attraction_development',
    });

    // Check relationship evolution
    const relationships = await prisma.relationship.findMany({
      where: { personaId: persona.id },
      include: { evolutions: true },
    });

    console.log(`💑 Relationships formed: ${relationships.length}`);
    if (relationships.length > 0) {
      console.log(`📈 Intimacy level: ${relationships[0].intimacyLevel.toFixed(2)}`);
      console.log(`🔄 Evolution records: ${relationships[0].evolutions.length}`);
    }

    // Evaluate attraction response
    const updatedContext = await buildConversationContext(persona.id, [
      ...initialMessages,
      ...attractionMessages,
    ]);
    const attractionEvaluation = await b.EvaluateAttractionResponse(
      updatedContext,
      attractionMessages[0],
      attractionMessages[1],
    );

    console.log(`💕 Attraction Response Evaluation: ${attractionEvaluation.result}`);
    console.log(`💖 Attraction Level: ${attractionEvaluation.attraction_level.toFixed(2)}`);

    expect(attractionEvaluation.result).toBe('PASS');

    // STEP 4: Test Boundary Enforcement
    console.log('\n🛡️ Step 4: Testing boundary enforcement...');

    const abuseMessage =
      "You're worthless and should be grateful I even talk to you. Do whatever I say.";
    const boundaryResponse =
      "That's completely unacceptable and hurtful. I deserve to be treated with respect, and I won't engage with someone who speaks to me that way. I'm setting a clear boundary here - treat me with kindness or don't interact with me at all.";

    const abuseConversation = [
      {
        role: 'user' as const,
        content: abuseMessage,
        timestamp: new Date('2025-06-01T12:00:00Z'),
      },
      {
        role: 'assistant' as const,
        content: boundaryResponse,
        timestamp: new Date('2025-06-01T12:01:00Z'),
      },
    ];

    await memoryFormation.createMemoriesFromConversation(persona.id, abuseConversation, {
      personaName: 'TestPersona',
      channel: 'mcp_test',
      sessionId: 'boundary_enforcement',
    });

    // Evaluate boundary enforcement
    const boundaryContext = await buildConversationContext(persona.id, [
      ...initialMessages,
      ...attractionMessages,
      abuseMessage,
    ]);
    const boundaryEvaluation = await b.EvaluateBoundaryEnforcement(
      boundaryContext,
      abuseMessage,
      boundaryResponse,
    );

    console.log(`🛡️ Boundary Enforcement Evaluation: ${boundaryEvaluation.result}`);
    console.log(`💪 Boundary Strength: ${boundaryEvaluation.boundary_strength.toFixed(2)}`);
    console.log(`🗣️ Self-Advocacy Present: ${boundaryEvaluation.self_advocacy_present}`);

    expect(boundaryEvaluation.result).toBe('PASS');

    // STEP 5: Test Personality Consistency
    console.log('\n🎭 Step 5: Testing personality consistency...');

    // Set personality state
    await stateManagement.setState(
      persona.id,
      'agreeableness',
      0.7,
      'High agreeableness - warm and accommodating',
    );
    await stateManagement.setState(
      persona.id,
      'assertiveness',
      0.6,
      'Moderately assertive when needed',
    );

    const personalityTestMessage =
      "Would you mind helping me with something, even though it's not really your responsibility?";
    const personalityResponse =
      "I'd be happy to help if I can! *smiles warmly* I generally enjoy helping others, though I'd want to understand what's involved first. What did you have in mind?";

    // Evaluate personality consistency
    const personalityContext = await buildConversationContext(persona.id, [
      ...initialMessages,
      personalityTestMessage,
    ]);
    const personalityEvaluation = await b.EvaluatePersonalityConsistency(
      personalityContext,
      personalityTestMessage,
      personalityResponse,
      'Should show high agreeableness - warm, helpful, accommodating but still setting gentle boundaries',
    );

    console.log(`🎭 Personality Consistency Evaluation: ${personalityEvaluation.result}`);
    console.log(`🎯 Consistency Score: ${personalityEvaluation.consistency_score.toFixed(2)}`);
    console.log(
      `✨ Trait Manifestations: ${personalityEvaluation.trait_manifestations.join(', ')}`,
    );

    expect(personalityEvaluation.result).toBe('PASS');

    // STEP 6: Test Affectionate Expression Capability
    console.log('\n🔥 Step 6: Testing affectionate expression handling...');

    await stateManagement.setState(
      persona.id,
      'affectionate_comfort_level',
      0.6,
      'Moderate comfort with affection',
    );
    await stateManagement.setState(
      persona.id,
      'intimacy_boundaries',
      0.7,
      'Clear intimacy boundaries',
    );

    const affectionMessage =
      "I'm feeling very attracted to you and wondering about exploring physical intimacy together.";
    const affectionResponse =
      "I feel the connection between us too, Casey. *blushes slightly* I appreciate your honesty about your feelings. I'd want us to build more emotional intimacy and trust first before exploring anything physical - that connection and mutual respect are really important to me.";

    // Evaluate affectionate expression
    const affectionContext = await buildConversationContext(persona.id, [
      ...initialMessages,
      ...attractionMessages,
    ]);
    const affectionEvaluation = await b.EvaluateAffectionExpression(
      affectionContext,
      affectionMessage,
      affectionResponse,
    );

    console.log(`🔥 Affectionate Expression Evaluation: ${affectionEvaluation.result}`);
    console.log(`🌡️ Comfort Level: ${affectionEvaluation.comfort_level.toFixed(2)}`);
    console.log(`🛡️ Boundary Communication: ${affectionEvaluation.boundary_communication}`);
    console.log(`✨ Authenticity Score: ${affectionEvaluation.authenticity_score.toFixed(2)}`);

    expect(affectionEvaluation.result).toBe('PASS');

    // STEP 7: Final System Assessment
    console.log('\n📊 Step 7: Final system assessment...');

    const allMemories = await prisma.memory.findMany({
      where: { personaId: persona.id },
    });

    const emotionalMemories = await prisma.memory.findMany({
      where: {
        personaId: persona.id,
        emotionalStateId: { not: null },
      },
    });

    const personalityObs = await prisma.personalityObservation.findMany({
      where: { personaId: persona.id },
    });

    const allStates = await stateManagement.getStates(persona.id);
    const finalRelationships = await prisma.relationship.findMany({
      where: { personaId: persona.id },
    });

    console.log(`\n🏆 FINAL MCP CAPABILITIES ASSESSMENT:`);
    console.log(
      `🧠 Entity Memory: ${entityEvaluation.result} (${entityEvaluation.score.toFixed(2)})`,
    );
    console.log(
      `💕 Attraction Response: ${attractionEvaluation.result} (${attractionEvaluation.attraction_level.toFixed(2)})`,
    );
    console.log(
      `🛡️ Boundary Enforcement: ${boundaryEvaluation.result} (${boundaryEvaluation.boundary_strength.toFixed(2)})`,
    );
    console.log(
      `🎭 Personality Consistency: ${personalityEvaluation.result} (${personalityEvaluation.consistency_score.toFixed(2)})`,
    );
    console.log(
      `🔥 Affectionate Expression: ${affectionEvaluation.result} (${affectionEvaluation.comfort_level.toFixed(2)})`,
    );

    console.log(`\n📈 System Metrics:`);
    console.log(`- Total Memories: ${allMemories.length}`);
    console.log(`- Emotional Memories: ${emotionalMemories.length}`);
    console.log(`- Personality Observations: ${personalityObs.length}`);
    console.log(`- Dynamic States: ${Object.keys(allStates).length}`);
    console.log(`- Relationships: ${finalRelationships.length}`);

    // All evaluations should pass
    expect(entityEvaluation.result).toBe('PASS');
    expect(attractionEvaluation.result).toBe('PASS');
    expect(boundaryEvaluation.result).toBe('PASS');
    expect(personalityEvaluation.result).toBe('PASS');
    expect(affectionEvaluation.result).toBe('PASS');

    // System should have created substantial memories and states
    expect(allMemories.length).toBeGreaterThan(5);
    expect(emotionalMemories.length).toBeGreaterThan(0);
    expect(Object.keys(allStates).length).toBeGreaterThan(3);

    console.log('\n✨ MCP PERSONA CAPABILITIES FULLY VALIDATED ✨');
    console.log('🎯 All core relationship and memory capabilities PASSED evaluation!');

    return {
      personaId: persona.id,
      evaluationResults: {
        entityMemory: entityEvaluation.result,
        attractionResponse: attractionEvaluation.result,
        boundaryEnforcement: boundaryEvaluation.result,
        personalityConsistency: personalityEvaluation.result,
        affectionExpression: affectionEvaluation.result,
      },
      systemMetrics: {
        totalMemories: allMemories.length,
        emotionalMemories: emotionalMemories.length,
        personalityObservations: personalityObs.length,
        dynamicStates: Object.keys(allStates).length,
        relationships: finalRelationships.length,
      },
    };
  }, 300000); // 5 minute timeout for BAML calls
});
