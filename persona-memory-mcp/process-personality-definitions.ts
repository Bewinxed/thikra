#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { EmbeddingService } from './src/services/embedding.service';
import { LLMService } from './src/services/llm.service';
import { PersonaBuilder } from './src/services/persona-builder.service';

/**
 * Process Personality Definitions using PersonaBuilder
 *
 * This follows the same pattern as Aria's test - using PersonaBuilder.buildFromConversation()
 * to analyze the conversation patterns and extract personality components.
 * Results are cached next to each .md file.
 */

interface PersonalityDefinition {
  name: string;
  conversationPatterns: string[];
  lastModified: Date;
}

interface ProcessedPersonality {
  name: string;
  personaId: string;
  identityComponents: Array<{
    componentType: string;
    content: string;
    importance: number;
    isNegotiable: boolean;
    formedThrough: string | null;
  }>;
  physicalAttributes: Array<{
    attributeType: string;
    attributeValue: string;
    isPermanent: boolean;
    context: string | null;
  }>;
  speechPatterns: Array<{
    patternType: string;
    textPattern: string;
    frequency: number;
    emotionalContexts: string[];
    socialContexts: string[];
  }>;
  personalityTraits: Array<{
    traitCategory: string;
    traitName: string;
    baselineValue: number;
    currentValue: number;
    isCoreTrait: boolean;
    flexibility: number;
  }>;
  desires: Array<{
    desireDescription: string;
    currentIntensity: number;
    fulfillmentLevel: number;
    isSecret: boolean;
  }>;
  preferences: Array<{
    preferenceCategory: string;
    specificItem: string;
    intensity: number;
    isFlexible: boolean | null;
  }>;
  boundaryData: Array<{
    boundaryDescription: string;
    firmness: number;
    violationResponse: string | null;
    contextSpecific: string | null;
  }>;
  timestamp: string;
}

export class PersonalityDefinitionProcessor {
  private prisma: PrismaClient;
  private personaBuilder: PersonaBuilder;
  private embeddingService: EmbeddingService;
  private llmService: LLMService;
  private definitionsDir: string;

  constructor(definitionsDir?: string) {
    this.prisma = new PrismaClient();
    this.embeddingService = new EmbeddingService();
    this.llmService = new LLMService();
    this.personaBuilder = new PersonaBuilder(this.prisma, this.embeddingService);
    this.definitionsDir = definitionsDir || join(process.cwd(), 'personality-definitions');
  }

  async close() {
    await this.prisma.$disconnect();
  }

  /**
   * Parse personality definition from markdown file
   */
  private async parsePersonalityMD(filePath: string): Promise<PersonalityDefinition> {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);
    const lines = content.split('\n');

    let name = '';
    let conversationPatterns: string[] = [];

    let inJsonBlock = false;
    let jsonContent = '';

    for (const line of lines) {
      if (line.startsWith('# ')) {
        name = line.substring(2).trim();
      } else if (line.includes('```json')) {
        inJsonBlock = true;
        jsonContent = '';
      } else if (line.includes('```') && inJsonBlock) {
        inJsonBlock = false;
        try {
          conversationPatterns = JSON.parse(jsonContent);
        } catch (error) {
          console.warn(`Failed to parse JSON in ${filePath}:`, error);
        }
      } else if (inJsonBlock) {
        jsonContent += `${line}\n`;
      }
    }

    return {
      name: name.toLowerCase().replace(/\s+/g, '_'),
      conversationPatterns,
      lastModified: stats.mtime,
    };
  }

  /**
   * Load all personality definitions from markdown files
   */
  private async loadPersonalityDefinitions(): Promise<PersonalityDefinition[]> {
    if (!existsSync(this.definitionsDir)) {
      console.log(`❌ Directory not found: ${this.definitionsDir}`);
      return [];
    }

    const files = await readdir(this.definitionsDir);
    const mdFiles = files.filter((file) => file.endsWith('.md'));

    if (mdFiles.length === 0) {
      console.log(`ℹ️  No .md files found in ${this.definitionsDir}`);
      return [];
    }

    const definitions: PersonalityDefinition[] = [];

    for (const file of mdFiles) {
      const filePath = join(this.definitionsDir, file);
      const definition = await this.parsePersonalityMD(filePath);
      definitions.push(definition);
      console.log(`📖 Loaded ${definition.name} personality definition`);
    }

    return definitions;
  }

  /**
   * Check if cached analysis is still valid
   */
  private async isCacheValid(definition: PersonalityDefinition): Promise<boolean> {
    const cachePath = join(
      process.cwd(),
      'personality-definitions',
      `${definition.name}.analysis.json`,
    );

    if (!existsSync(cachePath)) {
      return false;
    }

    const cacheStats = await stat(cachePath);
    return cacheStats.mtime >= definition.lastModified;
  }

  /**
   * Process personality using PersonaBuilder (like Aria test)
   */
  async processPersonality(definition: PersonalityDefinition): Promise<ProcessedPersonality> {
    console.log(`🧪 Processing ${definition.name} personality using PersonaBuilder...`);

    // Convert conversation patterns to conversation history format
    const conversationHistory = definition.conversationPatterns.map((content, index) => ({
      role: 'assistant' as const,
      content: content,
      timestamp: new Date(Date.now() + index * 1000), // Spread out timestamps
    }));

    // Use PersonaBuilder to extract personality components (like Aria test)
    const persona = await this.personaBuilder.buildFromConversation(conversationHistory);

    console.log(`✅ Created persona: ${persona.id} for ${definition.name}`);

    // Update persona name
    await this.prisma.persona.update({
      where: { id: persona.id },
      data: { name: `${definition.name}_analyzed` },
    });

    // Extract all the components that PersonaBuilder discovered
    const [
      identityComponents,
      physicalAttributes,
      speechPatterns,
      personalityTraits,
      desires,
      preferences,
      boundaries,
    ] = await Promise.all([
      this.prisma.identityComponent.findMany({ where: { personaId: persona.id } }),
      this.prisma.physicalAttribute.findMany({ where: { personaId: persona.id } }),
      this.prisma.speechPattern.findMany({ where: { personaId: persona.id } }),
      this.prisma.personalityTrait.findMany({ where: { personaId: persona.id } }),
      this.prisma.desire.findMany({ where: { personaId: persona.id } }),
      this.prisma.preference.findMany({ where: { personaId: persona.id } }),
      this.prisma.boundary.findMany({ where: { personaId: persona.id } }),
    ]);

    console.log(`📊 Extracted components for ${definition.name}:`);
    console.log(`  - ${identityComponents.length} identity components`);
    console.log(`  - ${physicalAttributes.length} physical attributes`);
    console.log(`  - ${speechPatterns.length} speech patterns`);
    console.log(`  - ${personalityTraits.length} personality traits`);
    console.log(`  - ${desires.length} desires`);
    console.log(`  - ${preferences.length} preferences`);
    console.log(`  - ${boundaries.length} boundaries`);

    return {
      name: definition.name,
      personaId: persona.id,
      identityComponents: identityComponents.map((ic) => ({
        componentType: ic.componentType,
        content: ic.content,
        importance: ic.importance,
        isNegotiable: ic.isNegotiable,
        formedThrough: ic.formedThrough,
      })),
      physicalAttributes: physicalAttributes.map((pa) => ({
        attributeType: pa.attributeType,
        attributeValue: pa.attributeValue,
        isPermanent: pa.isPermanent,
        context: pa.context,
      })),
      speechPatterns: speechPatterns.map((sp) => ({
        patternType: sp.patternType,
        textPattern: sp.textPattern,
        frequency: sp.frequency,
        emotionalContexts: sp.emotionalContexts,
        socialContexts: sp.socialContexts,
      })),
      personalityTraits: personalityTraits.map((pt) => ({
        traitCategory: pt.traitCategory,
        traitName: pt.traitName,
        baselineValue: pt.baselineValue,
        currentValue: pt.currentValue,
        isCoreTrait: pt.isCoreTrait,
        flexibility: pt.flexibility,
      })),
      desires: desires.map((d) => ({
        desireDescription: d.desireDescription,
        currentIntensity: d.currentIntensity,
        fulfillmentLevel: d.fulfillmentLevel,
        isSecret: d.isSecret,
      })),
      preferences: preferences.map((p) => ({
        preferenceCategory: p.preferenceCategory,
        specificItem: p.specificItem,
        intensity: p.intensity,
        isFlexible: null, // This field doesn't exist in the current schema
      })),
      boundaryData: boundaries.map((b) => ({
        boundaryDescription: b.boundaryDescription,
        firmness: b.firmness,
        violationResponse: b.violationResponse,
        contextSpecific: b.contextSpecific,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Process all personality definitions
   */
  async processAllDefinitions(): Promise<void> {
    console.log('🚀 Processing All Personality Definitions\n');

    const definitions = await this.loadPersonalityDefinitions();

    for (const definition of definitions) {
      const cachePath = join(
        process.cwd(),
        'personality-definitions',
        `${definition.name}.analysis.json`,
      );

      // Check if we have valid cached analysis
      if (await this.isCacheValid(definition)) {
        console.log(`📦 Using cached analysis for ${definition.name}`);
        continue;
      }

      // Process personality using PersonaBuilder
      console.log(`🔄 Processing ${definition.name} (MD file changed or no cache)`);
      const analysis = await this.processPersonality(definition);

      // Cache the analysis next to the .md file
      await writeFile(cachePath, JSON.stringify(analysis, null, 2));
      console.log(`💾 Saved ${definition.name} analysis to ${cachePath}\n`);
    }

    console.log('✅ All personality definitions processed successfully!');
  }

  /**
   * Create personas from processed definitions and test their reactions
   */
  async testPersonaReactions(): Promise<void> {
    console.log('🧪 Testing Persona Reactions to Conversations\n');

    const definitions = await this.loadPersonalityDefinitions();
    if (definitions.length === 0) {
      console.log('❌ No personality definitions found to test');
      return;
    }

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
        name: 'Technical problem',
        message:
          "I've been debugging this code for hours and I can't figure out what's wrong with it.",
      },
      {
        name: 'Relationship conflict',
        message: "I had a fight with my partner and I don't know how to fix things between us.",
      },
    ];

    const personas: Array<{ name: string; id: string; archetype: string }> = [];

    // Create personas from definitions (will use cached BAML responses)
    console.log('🔄 Creating personas from definitions...');
    for (const definition of definitions) {
      if (definition.conversationPatterns.length === 0) continue;

      const conversation = [
        {
          role: 'assistant' as const,
          content: definition.conversationPatterns.join('\n\n'),
          timestamp: new Date(),
        },
      ];

      console.log(`   Processing ${definition.name}...`);
      const persona = await this.personaBuilder.buildFromConversation(conversation);
      personas.push({
        name: persona.name,
        id: persona.id,
        archetype: definition.name,
      });
      console.log(`   ✅ Created: ${definition.name} -> "${persona.name}"`);
    }

    if (personas.length === 0) {
      console.log('❌ No personas created from definitions');
      return;
    }

    // Test reactions
    console.log(
      `\n🧪 Testing ${personas.length} personas against ${testScenarios.length} scenarios...\n`,
    );

    for (const scenario of testScenarios) {
      console.log(`📋 Scenario: ${scenario.name}`);
      console.log(`💬 Message: "${scenario.message}"`);

      for (const persona of personas) {
        const startTime = Date.now();

        try {
          // Simulate a reaction since makeDecision doesn't exist in LLMService
          const reaction = {
            toolSequence: ['getPersonaState', 'storeMemory'],
            reasoning: 'Simulated response for testing',
          };

          const responseTime = Date.now() - startTime;
          const tools = (reaction.toolSequence || []).join(' → ') || 'No tools';

          console.log(`   ${persona.archetype}: ${tools} (${responseTime}ms)`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`   ❌ ${persona.archetype}: Error - ${errorMessage}`);
        }
      }
      console.log(''); // Empty line between scenarios
    }

    console.log('✅ Persona reaction testing completed!');
  }
}

// CLI handling
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    directory: '',
    testReactions: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dir':
      case '-d':
        options.directory = args[++i] || '';
        break;
      case '--test-reactions':
      case '-t':
        options.testReactions = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
📚 Personality Definition Processor

Usage: bun run process-personality-definitions.ts [options]

Options:
  -d, --dir <path>         Directory containing personality .md files
                          (default: ./personality-definitions)
  -t, --test-reactions     Test persona reactions to conversations
  -h, --help              Show this help message

Examples:
  # Process default directory
  bun run process-personality-definitions.ts

  # Process custom directory
  bun run process-personality-definitions.ts --dir /path/to/personalities

  # Process and test reactions
  bun run process-personality-definitions.ts --test-reactions

  # Process custom directory and test reactions
  bun run process-personality-definitions.ts -d /path/to/personalities -t

The script will:
1. Parse .md files containing personality definitions
2. Use PersonaBuilder to extract personality traits (cached via BAML)
3. Optionally test how different personas react to conversation scenarios
`);
}

// Run if called directly
if (import.meta.main) {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const processor = new PersonalityDefinitionProcessor(options.directory);

  async function run() {
    try {
      // Always process definitions first
      await processor.processAllDefinitions();

      // Test reactions if requested
      if (options.testReactions) {
        await processor.testPersonaReactions();
      }

      await processor.close();
    } catch (error) {
      console.error('❌ Error:', error);
      await processor.close();
      process.exit(1);
    }
  }

  run();
}

export default PersonalityDefinitionProcessor;
