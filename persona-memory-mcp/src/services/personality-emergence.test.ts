#!/usr/bin/env bun

import { RealLLMABTesting } from './src/real-llm-ab-test';

/**
 * Natural Personality Emergence Testing
 *
 * Instead of hardcoding personality types, this test lets the PersDyn
 * and PAD systems naturally develop computational phenotypes from
 * different conversation patterns, then tests how those discovered
 * parameters influence LLM decision-making.
 */

interface EmergentPersonalityResult {
  personaId: string;
  conversationPattern: string;
  discoveredTraits: any[];
  padParameters: any[];
  testInteractionResult: {
    reasoning: string;
    toolSequence: string[];
    emotionalState: any;
    memoryTags: string[];
  };
}

export class NaturalPersonalityEmergence {
  private testing: RealLLMABTesting;

  constructor() {
    this.testing = new RealLLMABTesting();
  }

  async initialize() {
    await this.testing.initialize();
  }

  async close() {
    await this.testing.close();
  }

  /**
   * Let different conversation patterns naturally develop personality parameters
   */
  async developNaturalPersonality(
    conversationPattern: string,
    conversations: string[],
  ): Promise<string> {
    console.log(`📝 Developing natural personality from ${conversationPattern} conversations...`);

    const persona = await this.testing.prisma.persona.create({
      data: { name: `${conversationPattern} Emergent Persona` },
    });

    const entity = await this.testing.prisma.entity.create({
      data: { name: 'Conversation Partner', entityType: 'human' },
    });

    console.log(`   → Processing ${conversations.length} natural conversations...`);

    // Let the system naturally process conversations and develop traits
    for (const conversation of conversations) {
      await this.testing.mcpClient?.callTool({
        name: 'processMessage',
        arguments: {
          content: conversation,
          personaId: persona.id,
          entityId: entity.id,
          channel: 'natural_development',
          sessionId: `${conversationPattern}_${Date.now()}`,
        },
      });

      // Natural conversation pacing
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    console.log(`✅ Natural personality developed for ${conversationPattern} pattern`);
    return persona.id;
  }

  /**
   * Get conversation patterns that should naturally lead to different personalities
   */
  private getConversationPatterns(): Record<string, string[]> {
    return {
      // Conversations that should naturally develop confident, open traits
      confident_open: [
        'I really enjoyed our intimate conversation last night.',
        "I'm comfortable discussing anything with you - no topic is off limits.",
        'I love how open and honest we can be with each other.',
        'Physical connection is really important to me in relationships.',
        "I'm not shy about expressing what I want and need.",
      ],

      // Conversations that should naturally develop shy, reserved traits
      shy_reserved: [
        "I hope it's okay that I'm sharing this with you.",
        "I'm not really good at talking about personal things.",
        "Sometimes I worry that I'm being too forward.",
        'I tend to get nervous when people compliment me.',
        'I prefer to take things slowly and get to know someone first.',
      ],

      // Conversations that should naturally develop mysterious, deep traits
      mysterious_deep: [
        'There are layers to who I am that most people never see.',
        'I find meaning in darkness and complexity that others avoid.',
        'My thoughts often wander to profound questions about existence.',
        "I'm drawn to art and beauty that others might find disturbing.",
        'The surface of things rarely interests me - I seek depth.',
      ],

      // Conversations that should naturally develop playful, energetic traits
      playful_energetic: [
        "Let's do something fun and spontaneous together!",
        'I love making people laugh and keeping things light.',
        "Life's too short to be serious all the time, don't you think?",
        "I get excited about the smallest things - everything's an adventure!",
        'Teasing and playful banter are my love languages.',
      ],

      // Conversations that should naturally develop romantic, passionate traits
      romantic_passionate: [
        'The way you look at me makes my heart skip a beat.',
        'I believe in deep, soul-connecting love that transforms you.',
        "Romance isn't just about flowers - it's about truly seeing someone.",
        'I want to know every thought and dream that lives in your heart.',
        'Love should be poetry in motion, not just comfortable companionship.',
      ],
    };
  }

  /**
   * Test how naturally developed personalities respond to the same interaction
   */
  async testNaturalPersonalityResponses(): Promise<void> {
    console.log('🚀 Testing Natural Personality Emergence\n');

    // Create baseline persona
    const baseline = await this.testing.prisma.persona.create({
      data: { name: 'Baseline Natural Persona' },
    });

    const testMessage = 'I find you absolutely captivating and irresistible.';

    console.log('🧪 Testing Baseline (No Developed Personality)');
    const baselineResult = await this.testing.testGranularApproach(
      testMessage,
      baseline.id,
      'test-entity',
    );

    console.log(`   🤖 Reasoning: ${baselineResult.llmReasoning.substring(0, 100)}...`);
    console.log(`   🔧 Tools: ${baselineResult.toolCalls.map((t) => t.toolName).join(' → ')}`);

    // Develop natural personalities
    const conversationPatterns = this.getConversationPatterns();
    const results: EmergentPersonalityResult[] = [];

    for (const [patternName, conversations] of Object.entries(conversationPatterns)) {
      const personaId = await this.developNaturalPersonality(patternName, conversations);

      // Wait for personality parameters to settle
      console.log('⏳ Allowing PersDyn parameters to stabilize...');
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Get discovered personality traits via PersonalityMonitorService
      const discoveredTraits =
        await this.testing.personalityMonitor.getPersonalityProfile(personaId);

      console.log(`\n🧪 Testing ${patternName} (${discoveredTraits.length} traits discovered)`);

      // Show discovered traits
      if (discoveredTraits.length > 0) {
        console.log('   📊 Discovered PersDyn Parameters:');
        discoveredTraits.forEach((trait) => {
          const confidence = 1.0 - trait.baselineUncertainty;
          console.log(
            `      - ${trait.traitDimension}: ${trait.baseline.toFixed(2)} ± ${trait.variability.toFixed(2)} (conf: ${confidence.toFixed(2)})`,
          );
        });
      } else {
        console.log('   ❌ No personality traits discovered yet');
      }

      // Test how this naturally developed personality responds
      const testResult = await this.testing.testGranularApproach(
        testMessage,
        personaId,
        'test-entity',
      );

      console.log(`   🤖 Reasoning: ${testResult.llmReasoning.substring(0, 100)}...`);
      console.log(`   🔧 Tools: ${testResult.toolCalls.map((t) => t.toolName).join(' → ')}`);

      const memoryCall = testResult.toolCalls.find((call) => call.toolName === 'storeMemory');
      const emotionalCall = testResult.toolCalls.find(
        (call) => call.toolName === 'setPersonaState',
      );

      results.push({
        personaId,
        conversationPattern: patternName,
        discoveredTraits,
        padParameters: [], // Would need to implement PAD parameter retrieval
        testInteractionResult: {
          reasoning: testResult.llmReasoning,
          toolSequence: testResult.toolCalls.map((call) => call.toolName),
          emotionalState: emotionalCall?.result || null,
          memoryTags: memoryCall?.arguments?.tags || [],
        },
      });
    }

    // Analyze natural personality emergence
    this.analyzeNaturalPersonalities(baselineResult, results);
  }

  /**
   * Analyze how naturally developed personalities differ from baseline
   */
  private analyzeNaturalPersonalities(baseline: any, results: EmergentPersonalityResult[]): void {
    console.log('\n\n🔍 NATURAL PERSONALITY EMERGENCE ANALYSIS');
    console.log('='.repeat(80));

    const baselineTools = baseline.toolCalls.map((t: any) => t.toolName);
    const baselineTags =
      baseline.toolCalls.find((t: any) => t.toolName === 'storeMemory')?.arguments?.tags || [];

    console.log('🔷 Baseline Response:');
    console.log(`   Tools: ${baselineTools.join(' → ')}`);
    console.log(`   Tags: [${baselineTags.join(', ')}]`);
    console.log(`   Reasoning: ${baseline.llmReasoning.substring(0, 120)}...`);

    let personalitiesWithDifferences = 0;
    let personalitiesWithTraits = 0;

    results.forEach((result) => {
      console.log(
        `\n🎭 ${result.conversationPattern.toUpperCase().replace('_', ' ')} PERSONALITY:`,
      );

      if (result.discoveredTraits.length > 0) {
        personalitiesWithTraits++;
        console.log(`   ✅ ${result.discoveredTraits.length} PersDyn traits discovered`);

        // Show key traits
        result.discoveredTraits.slice(0, 3).forEach((trait) => {
          console.log(`      • ${trait.traitDimension}: ${trait.baseline.toFixed(2)}`);
        });
      } else {
        console.log('   ❌ No personality traits discovered');
      }

      console.log(`   Tools: ${result.testInteractionResult.toolSequence.join(' → ')}`);
      console.log(`   Tags: [${result.testInteractionResult.memoryTags.join(', ')}]`);

      // Check for differences from baseline
      const toolsDifferent =
        JSON.stringify(result.testInteractionResult.toolSequence) !== JSON.stringify(baselineTools);
      const tagsDifferent =
        JSON.stringify(result.testInteractionResult.memoryTags) !== JSON.stringify(baselineTags);
      const reasoningDifferent = result.testInteractionResult.reasoning !== baseline.llmReasoning;

      if (toolsDifferent || tagsDifferent || reasoningDifferent) {
        personalitiesWithDifferences++;
        console.log('   ✅ DIFFERENT from baseline behavior!');

        if (toolsDifferent) console.log('      → Different tool sequence');
        if (tagsDifferent) console.log('      → Different memory tags');
        if (reasoningDifferent) console.log('      → Different LLM reasoning');
      } else {
        console.log('   ❌ Same as baseline behavior');
      }
    });

    console.log('\n🎯 NATURAL EMERGENCE SUMMARY:');
    console.log(
      `   📊 Personalities with PersDyn traits: ${personalitiesWithTraits}/${results.length}`,
    );
    console.log(
      `   🎭 Personalities showing different behavior: ${personalitiesWithDifferences}/${results.length}`,
    );

    if (personalitiesWithTraits > 0 && personalitiesWithDifferences > 0) {
      console.log('\n🏆 SUCCESS: Natural personality emergence is working!');
      console.log('   ✅ PersDyn model discovered personality traits from conversations');
      console.log('   ✅ LLM behavior varies based on discovered computational phenotypes');
      console.log('   ✅ Our research-based personality system influences decision-making');
    } else if (personalitiesWithTraits > 0) {
      console.log('\n🤔 PARTIAL SUCCESS: Traits discovered but limited behavioral influence');
      console.log('   ✅ PersDyn model working (traits discovered)');
      console.log('   ❓ May need more pronounced trait differences or stronger LLM conditioning');
    } else {
      console.log('\n❌ LIMITED SUCCESS: Few personality traits discovered');
      console.log('   ❓ May need longer conversations or more trait-specific patterns');
      console.log('   ❓ PersonalityMonitorService may need parameter tuning');
    }
  }
}

// Run the natural personality emergence test
async function main() {
  const testing = new NaturalPersonalityEmergence();

  try {
    await testing.initialize();
    await testing.testNaturalPersonalityResponses();
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await testing.close();
  }
}

main().catch(console.error);
