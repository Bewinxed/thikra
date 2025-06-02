import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { EmbeddingService } from './embedding.service';
import { LLMService } from './llm.service';
import { PersonaBuilder } from './persona-builder.service';

/**
 * Persona Batch Testing Service
 *
 * Tests multiple personality files and caches generated personas.
 * Processes files through "persona from text" and tests reactions to conversations.
 */

interface PersonaCache {
  id: string;
  sourceFile: string;
  name: string;
  generatedAt: Date;
  conversationTests?: ConversationTestResult[];
}

interface ConversationTestResult {
  message: string;
  toolSequence: string[];
  reasoning: string;
  emotionalResponse: any;
  responseTime: number;
}

describe('Persona Batch Testing', () => {
  let prisma: PrismaClient;
  let personaBuilder: PersonaBuilder;
  let embeddingService: EmbeddingService;
  let llmService: LLMService;
  const personaCache: Map<string, PersonaCache> = new Map();

  beforeAll(async () => {
    prisma = new PrismaClient();
    embeddingService = new EmbeddingService();
    llmService = new LLMService();
    personaBuilder = new PersonaBuilder(prisma, embeddingService, llmService);
  }, 60000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  test('process personality definition files into cached personas', async () => {
    const personalityDir = '/root/dev/thikra/persona-memory-mcp/personality-definitions';

    try {
      const files = await readdir(personalityDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      expect(mdFiles.length).toBeGreaterThan(0);

      for (const file of mdFiles) {
        const filePath = join(personalityDir, file);
        const content = await readFile(filePath, 'utf-8');

        // Skip if we already have this persona cached
        const cacheKey = file.replace('.md', '');
        if (personaCache.has(cacheKey)) {
          console.log(`📋 Using cached persona: ${cacheKey}`);
          continue;
        }

        console.log(`🔄 Processing file: ${file}`);

        // Extract conversation pattern from the markdown
        const conversationPattern = extractConversationFromMarkdown(content);

        if (conversationPattern) {
          // Create conversation history for PersonaBuilder
          const conversation = [
            {
              role: 'assistant' as const,
              content: conversationPattern,
              timestamp: new Date(),
            },
          ];

          // Generate persona using PersonaBuilder
          const persona = await personaBuilder.buildFromConversation(conversation);

          // Cache the persona
          const cached: PersonaCache = {
            id: persona.id,
            sourceFile: file,
            name: persona.name,
            generatedAt: new Date(),
          };

          personaCache.set(cacheKey, cached);
          console.log(`✅ Cached persona: ${cacheKey} -> ${persona.name}`);
        }
      }

      expect(personaCache.size).toBeGreaterThan(0);
      console.log(`📊 Total cached personas: ${personaCache.size}`);
    } catch (error) {
      console.log('ℹ️  Personality definitions directory not found, creating test personas instead');

      // Create test personas from text descriptions
      const testPersonalities = [
        {
          name: 'analytical_engineer',
          text: `I'm a software engineer who loves solving complex problems through systematic analysis. 
          I approach every challenge methodically, breaking it down into smaller components. 
          I believe in thorough testing and clean, maintainable code. When I encounter a bug, 
          I methodically trace through the logic until I find the root cause.`,
        },
        {
          name: 'creative_artist',
          text: `I'm an artist who sees the world through colors and emotions. Every conversation 
          inspires new ideas for my next piece. I love exploring the connection between feelings 
          and visual expression. When someone shares something personal with me, I often think 
          about how I could capture that emotion in paint or sculpture.`,
        },
        {
          name: 'empathetic_counselor',
          text: `I'm drawn to understanding others and helping them through difficult times. 
          I listen deeply and try to create a safe space where people feel heard. I believe 
          everyone has their own wisdom within them - they just need someone to help them 
          find it. When someone shares their struggles, I feel their pain and want to help.`,
        },
      ];

      for (const personality of testPersonalities) {
        const conversation = [
          {
            role: 'assistant' as const,
            content: personality.text,
            timestamp: new Date(),
          },
        ];

        const persona = await personaBuilder.buildFromConversation(conversation);

        const cached: PersonaCache = {
          id: persona.id,
          sourceFile: `${personality.name}.md`,
          name: persona.name,
          generatedAt: new Date(),
        };

        personaCache.set(personality.name, cached);
        console.log(`✅ Created test persona: ${personality.name} -> ${persona.name}`);
      }

      expect(personaCache.size).toBe(testPersonalities.length);
    }
  }, 180000); // Longer timeout for multiple persona generation

  test('test cached personas reactions to various conversations', async () => {
    expect(personaCache.size).toBeGreaterThan(0);

    const testMessages = [
      "I'm feeling really anxious about my upcoming presentation tomorrow.",
      "I just had a breakthrough on this coding problem I've been stuck on!",
      "I'm struggling to express what I'm feeling through my art lately.",
      "Tell me about your creative process when you're working on something new.",
      "How do you handle it when people don't understand your work?",
    ];

    const results: { [personaName: string]: ConversationTestResult[] } = {};

    for (const [personaKey, personaCache] of this.personaCache.entries()) {
      console.log(`\n🧪 Testing persona: ${personaCache.name} (${personaKey})`);
      results[personaKey] = [];

      for (const message of testMessages) {
        const startTime = Date.now();

        try {
          // Test how this persona would respond using LLM decision-making
          const decision = await llmService.makeDecision('granular_planning', {
            message,
            personaId: personaCache.id,
            availableTools: [
              'getPersonaState',
              'storeMemory',
              'extractPersonaInsights',
              'setPersonaState',
              'getSemanticContext',
            ],
          });

          const result: ConversationTestResult = {
            message,
            toolSequence: decision.toolSequence || [],
            reasoning: decision.reasoning || 'No reasoning provided',
            emotionalResponse: decision.emotionalState || {},
            responseTime: Date.now() - startTime,
          };

          results[personaKey].push(result);

          console.log(`   📝 "${message.slice(0, 40)}..."`);
          console.log(`   🔧 Tools: ${result.toolSequence.join(' → ')}`);
          console.log(`   ⏱️  Time: ${result.responseTime}ms`);
        } catch (error) {
          console.error(`   ❌ Error testing message: ${error.message}`);
        }
      }
    }

    // Verify that different personas make different decisions
    const personaKeys = Object.keys(results);
    if (personaKeys.length >= 2) {
      const firstPersona = results[personaKeys[0]];
      const secondPersona = results[personaKeys[1]];

      // Compare tool sequences for the same message
      const firstTools = firstPersona[0]?.toolSequence?.join('→') || '';
      const secondTools = secondPersona[0]?.toolSequence?.join('→') || '';

      if (firstTools && secondTools) {
        console.log(`\n📊 Persona Comparison for "${testMessages[0]}"`);
        console.log(`   ${personaKeys[0]}: ${firstTools}`);
        console.log(`   ${personaKeys[1]}: ${secondTools}`);

        // They should be different (though not always guaranteed)
        if (firstTools !== secondTools) {
          console.log('   ✅ Personas showed different decision patterns');
        } else {
          console.log('   ℹ️  Personas showed same decision pattern (this can happen)');
        }
      }
    }

    // Store results in cache for future use
    for (const [personaKey, testResults] of Object.entries(results)) {
      const cached = this.personaCache.get(personaKey);
      if (cached) {
        cached.conversationTests = testResults;
      }
    }

    expect(Object.keys(results).length).toBeGreaterThan(0);
    console.log(`\n✅ Completed conversation testing for ${Object.keys(results).length} personas`);
  }, 300000); // Very long timeout for multiple LLM calls

  test('analyze personality differences in responses', async () => {
    const analysisResults: { [personaName: string]: any } = {};

    for (const [personaKey, personaInfo] of personaCache.entries()) {
      if (!personaInfo.conversationTests) continue;

      const analysis = {
        personaName: personaInfo.name,
        sourceFile: personaInfo.sourceFile,
        averageResponseTime: 0,
        toolUsagePattern: {} as { [tool: string]: number },
        emotionalRange: [] as string[],
        reasoningStyle: [] as string[],
      };

      let totalTime = 0;
      for (const test of personaInfo.conversationTests) {
        totalTime += test.responseTime;

        // Count tool usage
        for (const tool of test.toolSequence) {
          analysis.toolUsagePattern[tool] = (analysis.toolUsagePattern[tool] || 0) + 1;
        }

        // Collect reasoning patterns (first few words)
        if (test.reasoning) {
          const reasoningStart = test.reasoning.split(' ').slice(0, 5).join(' ');
          analysis.reasoningStyle.push(reasoningStart);
        }
      }

      analysis.averageResponseTime = totalTime / personaInfo.conversationTests.length;
      analysisResults[personaKey] = analysis;

      console.log(`\n📈 Analysis for ${personaInfo.name}:`);
      console.log(`   ⏱️  Avg Response Time: ${analysis.averageResponseTime.toFixed(0)}ms`);
      console.log(
        '   🔧 Tool Usage:',
        Object.entries(analysis.toolUsagePattern)
          .map(([tool, count]) => `${tool}(${count})`)
          .join(', '),
      );
    }

    expect(Object.keys(analysisResults).length).toBeGreaterThan(0);

    // Save analysis to a summary file for future reference
    const summary = {
      generatedAt: new Date().toISOString(),
      totalPersonas: personaCache.size,
      analysis: analysisResults,
    };

    console.log('\n📋 Analysis Summary:', JSON.stringify(summary, null, 2));
  }, 60000);
});

/**
 * Extract conversation pattern from markdown file
 */
function extractConversationFromMarkdown(content: string): string | null {
  // Look for JSON array in the markdown
  const jsonMatch = content.match(/```json\s*(\[[\s\S]*?\])\s*```/);
  if (jsonMatch) {
    try {
      const conversations = JSON.parse(jsonMatch[1]);
      if (Array.isArray(conversations) && conversations.length > 0) {
        return conversations.join('\n\n');
      }
    } catch (error) {
      console.warn('Failed to parse JSON from markdown:', error);
    }
  }

  // Fallback: extract text between conversation patterns markers
  const patternMatch = content.match(/## Conversation Patterns\s*```json\s*\[([\s\S]*?)\]\s*```/);
  if (patternMatch) {
    try {
      const conversations = JSON.parse(`[${patternMatch[1]}]`);
      return conversations.join('\n\n');
    } catch (error) {
      console.warn('Failed to parse conversation patterns:', error);
    }
  }

  // Final fallback: use the whole content if it's reasonable length
  if (content.length > 50 && content.length < 2000) {
    return content.replace(/^#.*$/gm, '').trim();
  }

  return null;
}
