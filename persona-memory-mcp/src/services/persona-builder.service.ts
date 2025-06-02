import type { Persona, PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { b } from '../../baml_client';
import type {
  DesiresExtractionResult,
  EmotionalExtractionResult,
  IdentityExtractionResult,
  PhysicalExtractionResult,
  SpeechExtractionResult,
} from '../../baml_client/types';
import { PromptCache } from '../utils/prompt-cache';
import type { EmbeddingService } from './embedding.service';

// Multi-pass extraction result using BAML types as source of truth
// Simple objects that will be mapped to database creates with personaId added
interface ExtractionResult {
  identityComponents: Array<{
    componentType: string;
    content: string;
    importance: number;
    isNegotiable: boolean;
    formedThrough?: string | null;
  }>;
  physicalAttributes: Array<{
    bodyPartId?: number | null;
    attributeType: string;
    attributeValue: string;
    isPermanent: boolean;
    context?: string | null;
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
    desireCategoryId?: number | null;
    desireDescription: string;
    currentIntensity: number;
    fulfillmentLevel: number;
    fulfillmentConditions: string[];
    isSecret: boolean;
  }>;
  preferences: Array<{
    preferenceCategory: string;
    specificItem: string;
    preferenceType: string;
    intensity: number;
    reason?: string | null;
  }>;
  boundaries: Array<{
    boundaryTypeId?: number | null;
    boundaryDescription: string;
    firmness: number;
    appliesToEntityId?: string | null;
    contextSpecific?: string | null;
    violationResponse?: string | null;
  }>;
}

export class PersonaBuilder {
  private promptCache: PromptCache;
  private bamlSchemaHash: string | null = null;

  constructor(
    private prisma: PrismaClient,
    private embeddingService: EmbeddingService,
  ) {
    this.promptCache = new PromptCache();
  }

  // Auto-generate schema version from BAML file content
  private async getBamlSchemaHash(): Promise<string> {
    if (this.bamlSchemaHash) {
      return this.bamlSchemaHash;
    }

    try {
      const crypto = require('node:crypto');
      const fs = require('node:fs/promises');
      const path = require('node:path');

      // Read BAML files and create hash
      const bamlDir = path.join(process.cwd(), 'baml_src');
      const files = await fs.readdir(bamlDir);
      const bamlFiles = files.filter((f: string) => f.endsWith('.baml')).sort();

      let combinedContent = '';
      for (const file of bamlFiles) {
        const content = await fs.readFile(path.join(bamlDir, file), 'utf-8');
        combinedContent += content;
      }

      const hash = crypto.createHash('md5').update(combinedContent).digest('hex').substring(0, 8);
      this.bamlSchemaHash = hash;
      return hash;
    } catch (error) {
      // Fallback if BAML files can't be read
      return 'default';
    }
  }

  // Build persona from conversation history - main entry point
  async buildFromConversation(
    conversationHistory: Array<{
      role: string;
      content: string;
      timestamp?: Date;
    }>,
  ): Promise<Persona> {
    const personaId = uuidv4();

    // Create base persona with temporary name (will generate dynamic name after extraction)
    const persona = await this.prisma.persona.create({
      data: {
        id: personaId,
        name: 'Building...',
        protectedTraits: [],
      },
    });

    // Multi-pass extraction for completeness (TODO.md Phase 4.2)
    // Extract from assistant messages (the LLM's responses show its personality)
    const assistantMessages = conversationHistory.filter((m) => m.role === 'assistant');
    const allContent = assistantMessages.map((m) => m.content).join('\n\n');

    const extraction = await this.multiPassExtraction(allContent);
    await this.saveExtractionResults(personaId, extraction);

    // Generate and update persona name based on extracted traits
    await this.updatePersonaName(personaId, extraction);

    // Return the updated persona with the generated name
    const updatedPersona = await this.prisma.persona.findUnique({
      where: { id: personaId },
    });

    return updatedPersona || persona;
  }

  // Extract persona insights from a single message and update existing persona
  async extractFromSingleMessage(content: string, personaId: string): Promise<void> {
    console.log(`🔍 Extracting persona insights from message for persona ${personaId}`);

    // Get existing persona context to avoid redundant analysis
    const existingPersona = await this.getExistingPersonaContext(personaId);
    const extraction = await this.contextAwareMultiPassExtraction(content, existingPersona);
    await this.saveExtractionResults(personaId, extraction);
  }

  // Build persona from explicit description
  async buildFromDescription(description: string): Promise<Persona> {
    const personaId = uuidv4();

    const persona = await this.prisma.persona.create({
      data: {
        id: personaId,
        name: 'Building...',
        protectedTraits: [],
      },
    });

    const extraction = await this.multiPassExtraction(description);
    await this.saveExtractionResults(personaId, extraction);

    // Generate and update persona name based on extracted traits
    await this.updatePersonaName(personaId, extraction);

    // Return the updated persona with the generated name
    const updatedPersona = await this.prisma.persona.findUnique({
      where: { id: personaId },
    });

    return updatedPersona || persona;
  }

  // Helper to cache BAML extraction calls
  private async cachedExtract<T>(
    functionName: string,
    content: string,
    extractFn: () => Promise<T>,
  ): Promise<T> {
    const schemaHash = await this.getBamlSchemaHash();

    // Try to load from cache first
    const cached = await this.promptCache.load(functionName, content, schemaHash);
    if (cached) {
      return JSON.parse(cached.response) as T;
    }

    // Execute the extraction
    const result = await extractFn();

    // Store in cache
    await this.promptCache.store(functionName, content, result, undefined, schemaHash);

    return result;
  }

  // Context-aware multi-pass extraction to avoid redundant analysis
  async contextAwareMultiPassExtraction(
    content: string,
    existingPersona: Awaited<ReturnType<typeof this.getExistingPersonaContext>>,
  ): Promise<ExtractionResult> {
    try {
      // Run extractions conditionally but maintain proper types
      const identityResult =
        existingPersona.identityComponents.length > 5
          ? null
          : await this.cachedExtract<IdentityExtractionResult>(
              'ExtractIdentityComponents',
              content,
              () => b.ExtractIdentityComponents(content),
            );

      const physicalResult =
        existingPersona.physicalAttributes.length > 3
          ? null
          : await this.cachedExtract<PhysicalExtractionResult>(
              'ExtractPhysicalAttributes',
              content,
              () => b.ExtractPhysicalAttributes(content),
            );

      const emotionalResult = await this.cachedExtract<EmotionalExtractionResult>(
        'ExtractEmotionalPatterns',
        content,
        () => b.ExtractEmotionalPatterns(content),
      );

      const speechResult =
        existingPersona.speechPatterns.length > 4
          ? null
          : await this.cachedExtract<SpeechExtractionResult>('ExtractSpeechPatterns', content, () =>
              b.ExtractSpeechPatterns(content),
            );

      const desiresResult = await this.cachedExtract<DesiresExtractionResult>(
        'ExtractDesiresAndBoundaries',
        content,
        () => b.ExtractDesiresAndBoundaries(content),
      );

      // Combine all results using correct BAML property names
      return {
        identityComponents: identityResult?.components || [],
        physicalAttributes: physicalResult?.attributes || [],
        personalityTraits: emotionalResult?.personalityTraits || [], // EmotionalExtractionResult has personalityTraits
        speechPatterns: speechResult?.speechPatterns || [], // SpeechExtractionResult has speechPatterns
        desires: desiresResult?.desires || [],
        preferences: desiresResult?.preferences || [], // DesiresExtractionResult also has preferences
        boundaries: desiresResult?.boundaries || [],
      };
    } catch (error) {
      console.error('Context-aware multi-pass extraction failed:', error);
      // Fallback to regular extraction
      return this.multiPassExtraction(content);
    }
  }

  // Get existing persona context to inform extraction decisions
  async getExistingPersonaContext(personaId: string) {
    const [identityComponents, physicalAttributes, speechPatterns] = await Promise.all([
      this.prisma.identityComponent.findMany({
        where: { personaId },
        take: 10, // Limit to prevent huge context
        select: { id: true, componentType: true },
      }),
      this.prisma.physicalAttribute.findMany({
        where: { personaId },
        take: 10,
        select: { id: true, attributeType: true },
      }),
      this.prisma.speechPattern.findMany({
        where: { personaId },
        take: 10,
        select: { id: true, patternType: true },
      }),
    ]);

    return {
      identityComponents,
      physicalAttributes,
      speechPatterns,
    };
  }

  // Multi-pass extraction following TODO.md specification
  private async multiPassExtraction(content: string): Promise<ExtractionResult> {
    try {
      // BATCH PROCESSING: Run all 5 extraction passes in parallel instead of sequentially
      const [identityResult, physicalResult, emotionalResult, speechResult, desiresResult] =
        await Promise.all([
          // Pass 1: Identity Components
          this.cachedExtract('ExtractIdentityComponents', content, () =>
            b.ExtractIdentityComponents(content),
          ),
          // Pass 2: Physical Attributes
          this.cachedExtract('ExtractPhysicalAttributes', content, () =>
            b.ExtractPhysicalAttributes(content),
          ),
          // Pass 3: Emotional Patterns
          this.cachedExtract('ExtractEmotionalPatterns', content, () =>
            b.ExtractEmotionalPatterns(content),
          ),
          // Pass 4: Speech Patterns
          this.cachedExtract('ExtractSpeechPatterns', content, () =>
            b.ExtractSpeechPatterns(content),
          ),
          // Pass 5: Desires and Boundaries
          this.cachedExtract('ExtractDesiresAndBoundaries', content, () =>
            b.ExtractDesiresAndBoundaries(content),
          ),
        ]);

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
        boundaries: (desiresResult.boundaries || []).map((b) => ({
          boundaryTypeId: b.boundaryTypeId ?? undefined,
          boundaryDescription: b.boundaryDescription,
          firmness: b.firmness,
          appliesToEntityId: b.appliesToEntityId ?? undefined,
          contextSpecific: b.contextSpecific ?? undefined,
          violationResponse: b.violationResponse ?? undefined,
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
        boundaries: [],
      };
    }
  }

  // Save extraction results to database using actual schema models
  async saveExtractionResults(personaId: string, results: ExtractionResult): Promise<void> {
    // Save identity components (use upsert to handle duplicates)
    for (const component of results.identityComponents) {
      await this.prisma.identityComponent.upsert({
        where: {
          personaId_componentType_content: {
            personaId,
            componentType: component.componentType,
            content: component.content,
          },
        },
        update: {
          importance: component.importance || 0.5,
          isNegotiable: component.isNegotiable !== undefined ? component.isNegotiable : true,
        },
        create: { personaId, ...component },
      });
    }

    // Save physical attributes
    for (const attr of results.physicalAttributes) {
      const attrData = { personaId, ...attr };
      // Validate bodyPartId against existing body parts
      if (attrData.bodyPartId) {
        const bodyPartExists = await this.prisma.bodyPart.findUnique({
          where: { id: attrData.bodyPartId },
        });
        if (!bodyPartExists) {
          attrData.bodyPartId = undefined;
        }
      }
      await this.prisma.physicalAttribute.create({
        data: attrData,
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
      const desireData = { personaId, ...desire };
      // Validate desireCategoryId against existing categories
      if (desireData.desireCategoryId) {
        const categoryExists = await this.prisma.desireCategory.findUnique({
          where: { id: desireData.desireCategoryId },
        });
        if (!categoryExists) {
          desireData.desireCategoryId = undefined;
        }
      }
      await this.prisma.desire.create({
        data: desireData,
      });
    }

    // Save preferences
    for (const pref of results.preferences) {
      await this.prisma.preference.create({
        data: { personaId, ...pref },
      });
    }

    // Save boundaries
    for (const boundary of results.boundaries) {
      const boundaryData = { personaId, ...boundary };
      // Validate boundaryTypeId against existing boundary types
      if (boundaryData.boundaryTypeId) {
        const boundaryTypeExists = await this.prisma.boundaryType.findUnique({
          where: { id: boundaryData.boundaryTypeId },
        });
        if (!boundaryTypeExists) {
          boundaryData.boundaryTypeId = undefined;
        }
      }
      // Validate appliesToEntityId against existing entities
      if (boundaryData.appliesToEntityId) {
        // Check if it's a valid UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(boundaryData.appliesToEntityId)) {
          // Not a valid UUID, skip entity validation
          boundaryData.appliesToEntityId = undefined;
        } else {
          const entityExists = await this.prisma.entity.findUnique({
            where: { id: boundaryData.appliesToEntityId },
          });
          if (!entityExists) {
            boundaryData.appliesToEntityId = undefined;
          }
        }
      }
      await this.prisma.boundary.create({
        data: boundaryData,
      });
    }

    // Initialize persona state (upsert to handle duplicate calls)
    await this.prisma.personaState.upsert({
      where: {
        personaId_stateKey: {
          personaId,
          stateKey: 'initialized',
        },
      },
      update: {
        stateValue: new Date().toISOString(),
        lastUpdated: new Date(),
        updateCount: {
          increment: 1,
        },
      },
      create: {
        personaId,
        stateKey: 'initialized',
        stateValue: new Date().toISOString(),
        valueType: 'timestamp',
        isConsciousOf: true,
      },
    });
  }

  /**
   * Update persona name based on extracted characteristics
   * Replaces hardcoded generic names with dynamic generation
   */
  private async updatePersonaName(personaId: string, extraction: ExtractionResult): Promise<void> {
    try {
      // Prepare context for name generation from extraction result
      const personalityTraits =
        extraction.personalityTraits.map((t) => `${t.traitName} (${t.baselineValue})`).join('; ') ||
        '';

      const emotionalPatternsStr =
        extraction.personalityTraits
          .filter((t) => t.isCoreTrait)
          .map((t) => t.traitName)
          .join('; ') || '';

      const identityComponentsStr =
        extraction.identityComponents.map((c) => `${c.componentType}: ${c.content}`).join('; ') ||
        '';

      // Generate dynamic name using BAML function
      const nameResult = await b.GeneratePersonaName(
        personalityTraits,
        emotionalPatternsStr,
        identityComponentsStr,
      );

      // Update persona with generated name
      await this.prisma.persona.update({
        where: { id: personaId },
        data: { name: nameResult.name },
      });

      console.log(
        `Updated persona ${personaId} name to: ${nameResult.name} (${nameResult.reasoning})`,
      );
    } catch (error) {
      console.warn(
        `Failed to generate dynamic name for persona ${personaId}, using fallback:`,
        error,
      );
      // Fallback to descriptive name based on available data
      await this.prisma.persona.update({
        where: { id: personaId },
        data: { name: `Persona-${personaId.slice(0, 8)}` },
      });
    }
  }
}
