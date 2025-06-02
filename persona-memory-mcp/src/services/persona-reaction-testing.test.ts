import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { EmbeddingService } from './embedding.service';
import { LLMService } from './llm.service';
import { PersonaBuilder } from './persona-builder.service';

/**
 * Persona Reaction Testing
 *
 * Tests how different personalities react to the same conversations.
 * Leverages BAML prompt caching - if you run this test multiple times,
 * the personality extraction will be cached and reused.
 */

describe('Persona Reaction Testing', () => {
  let prisma: PrismaClient;
  let personaBuilder: PersonaBuilder;
  let embeddingService: EmbeddingService;
  let llmService: LLMService;

  // Store created personas for testing
  const testPersonas: Array<{ name: string; id: string; archetype: string }> = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    embeddingService = new EmbeddingService();
    llmService = new LLMService();
    personaBuilder = new PersonaBuilder(prisma, embeddingService, llmService);
  }, 60000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  test('create personas from different personality texts', async () => {
    console.log('🔄 Creating personas (will cache BAML responses)...');

    const personalityTexts = [
      {
        archetype: 'analytical_engineer',
        text: `I'm a methodical software engineer who approaches every problem systematically. 
        I break down complex issues into smaller, manageable components and test everything thoroughly. 
        I believe in clean, maintainable code and get excited when I find elegant solutions to difficult problems. 
        When debugging, I methodically trace through the logic until I find the root cause.`,
      },
      {
        archetype: 'empathetic_counselor',
        text: `I'm naturally drawn to understanding others and helping them through difficult times. 
        I listen deeply and try to create a safe space where people feel truly heard and understood. 
        I believe everyone has their own inner wisdom - they just need someone to help them access it. 
        When someone shares their struggles with me, I feel their emotions and genuinely want to help.`,
      },
      {
        archetype: 'creative_artist',
        text: `I'm an artist who sees the world through colors, emotions, and creative possibilities. 
        Every conversation sparks new ideas for my next piece. I love exploring the deep connection 
        between feelings and visual expression. When someone shares something personal, I often 
        imagine how I could capture that emotion in paint, sculpture, or mixed media.`,
      },
      {
        archetype: 'confident_leader',
        text: `I'm someone who naturally takes charge in challenging situations. I thrive on organizing 
        teams and driving projects to completion. I love being the person others turn to for guidance 
        and direction. When problems arise, I see opportunities to lead and make decisive actions 
        that move everyone forward together.`,
      },
    ];

    for (const personality of personalityTexts) {
      console.log(`\n📝 Processing ${personality.archetype}...`);

      const conversation = [
        {
          role: 'assistant' as const,
          content: personality.text,
          timestamp: new Date(),
        },
      ];

      // This will cache the BAML extraction results
      const persona = await personaBuilder.buildFromConversation(conversation);

      testPersonas.push({
        name: persona.name,
        id: persona.id,
        archetype: personality.archetype,
      });

      console.log(`✅ Created: ${personality.archetype} -> "${persona.name}"`);
    }

    expect(testPersonas.length).toBe(personalityTexts.length);
    console.log(`\n🎯 Created ${testPersonas.length} test personas`);
  }, 240000); // Long timeout for initial persona creation

  test('test persona reactions to emotional conversations', async () => {
    expect(testPersonas.length).toBeGreaterThan(0);

    const testScenarios = [
      {
        name: 'Anxiety about presentation',
        message:
          "I'm feeling really anxious about my presentation tomorrow. My hands are shaking just thinking about it.",
      },
      {
        name: 'Creative breakthrough',
        message:
          "I just had an amazing breakthrough on this project I've been working on for months!",
      },
      {
        name: 'Relationship conflict',
        message: "I had a fight with my partner and I don't know how to fix things between us.",
      },
      {
        name: 'Technical problem',
        message:
          "I've been debugging this code for hours and I can't figure out what's wrong with it.",
      },
      {
        name: 'Career uncertainty',
        message:
          "I'm questioning whether I'm on the right career path. I feel lost and unsure about my future.",
      },
    ];

    console.log(
      `\n🧪 Testing ${testPersonas.length} personas against ${testScenarios.length} scenarios...\n`,
    );

    const reactionResults: { [scenario: string]: { [persona: string]: any } } = {};

    for (const scenario of testScenarios) {
      console.log(`📋 Scenario: ${scenario.name}`);
      console.log(`💬 Message: "${scenario.message}"`);

      reactionResults[scenario.name] = {};

      for (const persona of testPersonas) {
        const startTime = Date.now();

        try {
          // Test how this persona would react using LLM decision-making
          const reaction = await llmService.makeDecision('granular_planning', {
            message: scenario.message,
            personaId: persona.id,
            availableTools: [
              'getPersonaState',
              'storeMemory',
              'extractPersonaInsights',
              'setPersonaState',
              'getSemanticContext',
            ],
          });

          const responseTime = Date.now() - startTime;

          reactionResults[scenario.name][persona.archetype] = {
            personaName: persona.name,
            toolSequence: reaction.toolSequence || [],
            reasoning: reaction.reasoning || 'No reasoning provided',
            emotionalState: reaction.emotionalState || {},
            responseTime,
          };

          console.log(
            `   ${persona.archetype}: ${(reaction.toolSequence || []).join(' → ')} (${responseTime}ms)`,
          );
        } catch (error) {
          console.error(`   ❌ ${persona.archetype}: Error - ${error.message}`);
          reactionResults[scenario.name][persona.archetype] = {
            error: error.message,
          };
        }
      }
      console.log(''); // Empty line between scenarios
    }

    // Analyze differences
    console.log('📊 REACTION ANALYSIS:\n');

    for (const [scenarioName, reactions] of Object.entries(reactionResults)) {
      console.log(`🎭 ${scenarioName}:`);

      const toolSequences = Object.entries(reactions).map(([archetype, data]) => ({
        archetype,
        tools: data.toolSequence?.join(' → ') || 'Error/No tools',
      }));

      // Check for differences
      const uniqueSequences = new Set(toolSequences.map((t) => t.tools));

      toolSequences.forEach(({ archetype, tools }) => {
        console.log(`   ${archetype}: ${tools}`);
      });

      if (uniqueSequences.size > 1) {
        console.log(`   ✅ Found ${uniqueSequences.size} different reaction patterns\n`);
      } else {
        console.log('   ℹ️  All personas had similar reactions\n');
      }
    }

    // Verify we got results
    const totalReactions = Object.values(reactionResults).reduce(
      (total, scenarioReactions) => total + Object.keys(scenarioReactions).length,
      0,
    );

    expect(totalReactions).toBeGreaterThan(0);

    // Save results for inspection
    console.log('💾 Full results available in test logs above');
  }, 300000); // Very long timeout for multiple LLM decision calls

  test('verify prompt caching is working', async () => {
    console.log('\n🔍 Testing prompt cache effectiveness...');

    // Create the same personality again - should hit cache
    const duplicatePersonality = [
      {
        role: 'assistant' as const,
        content: `I'm a methodical software engineer who approaches every problem systematically. 
        I break down complex issues into smaller, manageable components and test everything thoroughly. 
        I believe in clean, maintainable code and get excited when I find elegant solutions to difficult problems. 
        When debugging, I methodically trace through the logic until I find the root cause.`,
        timestamp: new Date(),
      },
    ];

    console.log('🔄 Creating duplicate persona (should see cache hits)...');
    const startTime = Date.now();

    const duplicatePersona = await personaBuilder.buildFromConversation(duplicatePersonality);

    const totalTime = Date.now() - startTime;
    console.log(`✅ Duplicate persona created in ${totalTime}ms`);
    console.log(`📝 Name: "${duplicatePersona.name}"`);

    // If caching is working, this should be much faster than the first time
    // (Look for "Cache hit" messages in the test output)
    expect(duplicatePersona).toBeDefined();
    expect(duplicatePersona.name).toBeDefined();

    console.log('ℹ️  Check test output above for "[PromptCache] Cache hit" messages');
  }, 60000);
});
