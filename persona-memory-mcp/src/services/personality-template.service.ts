import type { PrismaClient } from '@prisma/client';
import type { EmbeddingService } from './embedding.service';
import type { LLMService } from './llm.service';
import type { PersonaBuilder } from './persona-builder.service';

/**
 * Personality Template Service
 *
 * Replaces file-based personality-definitions with database-driven approach.
 * Provides automated template generation, versioning, and caching.
 */

export interface PersonalityTemplate {
  id: string;
  name: string;
  archetype: string;
  version: number;
  conversationPattern: string;
  traits: PersonalityTrait[];
  interests: string[];
  speechPatterns: SpeechPattern[];
  coreValues: string[];
  metadata: {
    generatedFrom: 'archetype' | 'text' | 'manual';
    sourceData?: string;
    generatedAt: Date;
    confidence: number;
  };
}

interface PersonalityTrait {
  name: string;
  description: string;
  intensity: number;
  category: string;
}

interface SpeechPattern {
  pattern: string;
  context: string;
  frequency: number;
  examples: string[];
}

export class PersonalityTemplateService {
  constructor(
    private prisma: PrismaClient,
    private personaBuilder: PersonaBuilder,
    private embeddingService: EmbeddingService,
    private llmService: LLMService,
  ) {}

  /**
   * Generate template from archetype
   */
  async generateFromArchetype(
    archetype: string,
    options?: {
      name?: string;
      version?: number;
      cacheResults?: boolean;
    },
  ): Promise<PersonalityTemplate> {
    // Check for existing cached template
    if (options?.cacheResults !== false) {
      const existing = await this.getCachedTemplate(archetype, 'archetype');
      if (existing) return existing;
    }

    const template = await this.personaBuilder.generateFromArchetype(archetype);

    const personalityTemplate: PersonalityTemplate = {
      id: crypto.randomUUID(),
      name: options?.name || template.name,
      archetype,
      version: options?.version || 1,
      conversationPattern: template.conversationPattern,
      traits: template.traits,
      interests: template.interests,
      speechPatterns: template.speechPatterns,
      coreValues: template.coreValues,
      metadata: {
        generatedFrom: 'archetype',
        sourceData: archetype,
        generatedAt: new Date(),
        confidence: 0.8,
      },
    };

    if (options?.cacheResults !== false) {
      await this.cacheTemplate(personalityTemplate);
    }

    return personalityTemplate;
  }

  /**
   * Generate template from free text description
   */
  async generateFromText(
    text: string,
    options?: {
      name?: string;
      archetype?: string;
      cacheResults?: boolean;
    },
  ): Promise<PersonalityTemplate> {
    const template = await this.personaBuilder.generateFromText(text);

    const personalityTemplate: PersonalityTemplate = {
      id: crypto.randomUUID(),
      name: options?.name || template.name,
      archetype: options?.archetype || 'custom',
      version: 1,
      conversationPattern: template.conversationPattern,
      traits: template.traits,
      interests: template.interests,
      speechPatterns: template.speechPatterns,
      coreValues: template.coreValues,
      metadata: {
        generatedFrom: 'text',
        sourceData: text,
        generatedAt: new Date(),
        confidence: 0.7,
      },
    };

    if (options?.cacheResults !== false) {
      await this.cacheTemplate(personalityTemplate);
    }

    return personalityTemplate;
  }

  /**
   * Build persona from template
   */
  async buildPersonaFromTemplate(
    templateId: string,
    personaName?: string,
  ): Promise<{ personaId: string; template: PersonalityTemplate }> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Create new persona
    const persona = await this.prisma.persona.create({
      data: {
        name: personaName || `${template.name} Instance`,
      },
    });

    // Build persona using conversation pattern
    await this.personaBuilder.buildFromConversation(persona.id, template.conversationPattern);

    return { personaId: persona.id, template };
  }

  /**
   * Get predefined personality archetypes
   */
  getAvailableArchetypes(): string[] {
    return [
      'confident_intimate',
      'mysterious_deep',
      'playful_energetic',
      'shy_innocent',
      'romantic_passionate',
      'analytical_logical',
      'creative_artistic',
      'nurturing_caring',
      'adventurous_bold',
      'intellectual_curious',
    ];
  }

  /**
   * Cache template in database
   */
  private async cacheTemplate(template: PersonalityTemplate): Promise<void> {
    await this.prisma.personalityTemplate.upsert({
      where: {
        archetype_version: {
          archetype: template.archetype,
          version: template.version,
        },
      },
      update: {
        name: template.name,
        conversationPattern: template.conversationPattern,
        traits: template.traits,
        interests: template.interests,
        speechPatterns: template.speechPatterns,
        coreValues: template.coreValues,
        metadata: template.metadata,
        updatedAt: new Date(),
      },
      create: {
        id: template.id,
        name: template.name,
        archetype: template.archetype,
        version: template.version,
        conversationPattern: template.conversationPattern,
        traits: template.traits,
        interests: template.interests,
        speechPatterns: template.speechPatterns,
        coreValues: template.coreValues,
        metadata: template.metadata,
      },
    });
  }

  /**
   * Get cached template
   */
  private async getCachedTemplate(
    archetype: string,
    generatedFrom: string,
  ): Promise<PersonalityTemplate | null> {
    const cached = await this.prisma.personalityTemplate.findFirst({
      where: {
        archetype,
        metadata: {
          path: ['generatedFrom'],
          equals: generatedFrom,
        },
      },
      orderBy: { version: 'desc' },
    });

    if (!cached) return null;

    return {
      id: cached.id,
      name: cached.name,
      archetype: cached.archetype,
      version: cached.version,
      conversationPattern: cached.conversationPattern,
      traits: cached.traits as PersonalityTrait[],
      interests: cached.interests as string[],
      speechPatterns: cached.speechPatterns as SpeechPattern[],
      coreValues: cached.coreValues as string[],
      metadata: cached.metadata as any,
    };
  }

  /**
   * Get template by ID
   */
  async getTemplate(id: string): Promise<PersonalityTemplate | null> {
    const template = await this.prisma.personalityTemplate.findUnique({
      where: { id },
    });

    if (!template) return null;

    return {
      id: template.id,
      name: template.name,
      archetype: template.archetype,
      version: template.version,
      conversationPattern: template.conversationPattern,
      traits: template.traits as PersonalityTrait[],
      interests: template.interests as string[],
      speechPatterns: template.speechPatterns as SpeechPattern[],
      coreValues: template.coreValues as string[],
      metadata: template.metadata as any,
    };
  }

  /**
   * List all templates
   */
  async listTemplates(archetype?: string): Promise<PersonalityTemplate[]> {
    const templates = await this.prisma.personalityTemplate.findMany({
      where: archetype ? { archetype } : undefined,
      orderBy: [{ archetype: 'asc' }, { version: 'desc' }],
    });

    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      archetype: t.archetype,
      version: t.version,
      conversationPattern: t.conversationPattern,
      traits: t.traits as PersonalityTrait[],
      interests: t.interests as string[],
      speechPatterns: t.speechPatterns as SpeechPattern[],
      coreValues: t.coreValues as string[],
      metadata: t.metadata as any,
    }));
  }

  /**
   * Test personality template influence
   */
  async testTemplateInfluence(
    templateId: string,
    testMessages: string[],
  ): Promise<{
    templateName: string;
    results: Array<{
      message: string;
      toolSequence: string[];
      reasoning: string;
      emotionalResponse: any;
    }>;
  }> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Create test persona from template
    const { personaId } = await this.buildPersonaFromTemplate(templateId);

    const results = [];
    for (const message of testMessages) {
      const decision = await this.llmService.makeDecision('granular_planning', {
        message,
        personaId,
        availableTools: [
          'getPersonaState',
          'storeMemory',
          'extractPersonaInsights',
          'setPersonaState',
        ],
      });

      results.push({
        message,
        toolSequence: decision.toolSequence || [],
        reasoning: decision.reasoning || '',
        emotionalResponse: decision.emotionalState || {},
      });
    }

    return {
      templateName: template.name,
      results,
    };
  }
}
