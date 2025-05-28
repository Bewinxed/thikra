import type { Persona, PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { b } from '../../baml_client';
import type { EmbeddingService } from './embedding.service';
import { PromptCache } from '../utils/prompt-cache';

// Multi-pass extraction result following TODO.md Phase 4
// Types match BAML nullable outputs and convert to Prisma optional inputs
interface ExtractionResult {
  identityComponents: Array<{
    componentType: string;
    content: string;
    importance: number;
    isNegotiable: boolean;
    formedThrough?: string;
  }>;
  physicalAttributes: Array<{
    bodyPartId?: number;
    attributeType: string;
    attributeValue: string;
    isPermanent: boolean;
    context?: string;
  }>;
  personalityTraits: Array<{
    traitCategory: string;
    traitName: string;
    baselineValue: number;
    currentValue: number;
    isCoreTrait: boolean;
    flexibility: number;
  }>;
  speechPatterns: Array<{
    patternType: string;
    textPattern: string;
    frequency: number;
    emotionalContexts: string[];
    socialContexts: string[];
    variations: string[];
  }>;
  desires: Array<{
    desireCategoryId?: number;
    desireDescription: string;
    currentIntensity: number;
    fulfillmentLevel: number;
    fulfillmentConditions: string[];
    isSecret: boolean;
  }>;
  preferences: Array<{
    preferenceCategory: string;
    specificItem: string;
    preferenceType: 'like' | 'dislike';
    intensity: number;
    reason?: string;
  }>;
}

export class PersonaBuilder {
  private promptCache: PromptCache;

  constructor(
    private prisma: PrismaClient,
    private embeddingService: EmbeddingService,
  ) {
    this.promptCache = new PromptCache();
  }

  // Build persona from conversation history - main entry point
  async buildFromConversation(
    conversationHistory: Array<{ role: string; content: string; timestamp?: Date }>,
  ): Promise<Persona> {
    const personaId = uuidv4();

    // Create base persona
    const persona = await this.prisma.persona.create({
      data: {
        id: personaId,
        name: 'Discovered Persona',
        protectedTraits: [],
      },
    });

    // Multi-pass extraction for completeness (TODO.md Phase 4.2)
    const allContent = conversationHistory
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n\n');

    const extraction = await this.multiPassExtraction(allContent);
    await this.saveExtractionResults(personaId, extraction);

    return persona;
  }

  // Build persona from explicit description
  async buildFromDescription(description: string): Promise<Persona> {
    const personaId = uuidv4();

    const persona = await this.prisma.persona.create({
      data: {
        id: personaId,
        name: 'Described Persona',
        protectedTraits: [],
      },
    });

    const extraction = await this.multiPassExtraction(description);
    await this.saveExtractionResults(personaId, extraction);

    return persona;
  }

  // Helper to cache BAML extraction calls
  private async cachedExtract<T>(
    functionName: string,
    content: string,
    extractFn: () => Promise<T>,
  ): Promise<T> {
    // Try to load from cache first
    const cached = await this.promptCache.load(functionName, content);
    if (cached) {
      return JSON.parse(cached.response) as T;
    }

    // Execute the extraction
    const result = await extractFn();

    // Store in cache
    await this.promptCache.store(
      functionName,
      content,
      result,
      undefined,
    );

    return result;
  }

  // Multi-pass extraction following TODO.md specification
  private async multiPassExtraction(content: string): Promise<ExtractionResult> {
    try {
      // Check cache first for all extractions
      const cacheKey = `persona_builder_${content}`;
      
      // Pass 1: Identity Components
      const identityResult = await this.cachedExtract(
        'ExtractIdentityComponents',
        content,
        () => b.ExtractIdentityComponents(content)
      );

      // Pass 2: Physical Attributes
      const physicalResult = await this.cachedExtract(
        'ExtractPhysicalAttributes',
        content,
        () => b.ExtractPhysicalAttributes(content)
      );

      // Pass 3: Emotional Patterns
      const emotionalResult = await this.cachedExtract(
        'ExtractEmotionalPatterns',
        content,
        () => b.ExtractEmotionalPatterns(content)
      );

      // Pass 4: Speech Patterns
      const speechResult = await this.cachedExtract(
        'ExtractSpeechPatterns',
        content,
        () => b.ExtractSpeechPatterns(content)
      );

      // Pass 5: Desires and Boundaries
      const desiresResult = await this.cachedExtract(
        'ExtractDesiresAndBoundaries',
        content,
        () => b.ExtractDesiresAndBoundaries(content)
      );

      return {
        identityComponents: identityResult.components.map((c) => ({
          componentType: c.componentType,
          content: c.content,
          importance: c.importance,
          isNegotiable: c.isNegotiable,
          formedThrough: c.formedThrough ?? undefined,
        })),
        physicalAttributes: physicalResult.attributes.map((a) => ({
          bodyPartId: a.bodyPartId ?? undefined,
          attributeType: a.attributeType,
          attributeValue: a.attributeValue,
          isPermanent: a.isPermanent,
          context: a.context ?? undefined,
        })),
        personalityTraits: emotionalResult.personalityTraits.map((t) => ({
          traitCategory: t.traitCategory,
          traitName: t.traitName,
          baselineValue: t.baselineValue,
          currentValue: t.currentValue,
          isCoreTrait: t.isCoreTrait,
          flexibility: t.flexibility,
        })),
        speechPatterns: speechResult.speechPatterns.map((p) => ({
          patternType: p.patternType,
          textPattern: p.textPattern,
          frequency: p.frequency,
          emotionalContexts: p.emotionalContexts,
          socialContexts: p.socialContexts,
          variations: p.variations,
        })),
        desires: desiresResult.desires.map((d) => ({
          desireCategoryId: d.desireCategoryId ?? undefined,
          desireDescription: d.desireDescription,
          currentIntensity: d.currentIntensity,
          fulfillmentLevel: d.fulfillmentLevel,
          fulfillmentConditions: d.fulfillmentConditions,
          isSecret: d.isSecret,
        })),
        preferences: desiresResult.preferences.map((p) => ({
          preferenceCategory: p.preferenceCategory,
          specificItem: p.specificItem,
          preferenceType: p.preferenceType as 'like' | 'dislike',
          intensity: p.intensity,
          reason: p.reason ?? undefined,
        })),
      };
    } catch (error) {
      console.error('Error in multi-pass extraction:', error);
      // Return empty results on error
      return {
        identityComponents: [],
        physicalAttributes: [],
        personalityTraits: [],
        speechPatterns: [],
        desires: [],
        preferences: [],
      };
    }
  }

  // Save extraction results to database using actual schema models
  private async saveExtractionResults(personaId: string, results: ExtractionResult): Promise<void> {
    // Save identity components
    for (const component of results.identityComponents) {
      await this.prisma.identityComponent.create({
        data: { personaId, ...component },
      });
    }

    // Save physical attributes
    for (const attr of results.physicalAttributes) {
      await this.prisma.physicalAttribute.create({
        data: { personaId, ...attr },
      });
    }

    // Save personality traits
    for (const trait of results.personalityTraits) {
      await this.prisma.personalityTrait.create({
        data: { personaId, ...trait },
      });
    }

    // Save speech patterns
    for (const pattern of results.speechPatterns) {
      await this.prisma.speechPattern.create({
        data: { personaId, ...pattern },
      });
    }

    // Save desires
    for (const desire of results.desires) {
      await this.prisma.desire.create({
        data: { personaId, ...desire },
      });
    }

    // Save preferences
    for (const pref of results.preferences) {
      await this.prisma.preference.create({
        data: { personaId, ...pref },
      });
    }

    // Initialize persona state
    await this.prisma.personaState.create({
      data: {
        personaId,
        stateKey: 'initialized',
        stateValue: new Date().toISOString(),
        valueType: 'timestamp',
        isConsciousOf: true,
      },
    });
  }
}
