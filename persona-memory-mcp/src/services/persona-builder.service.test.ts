import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { b } from '../../baml_client';
import { PromptCache } from '../utils/prompt-cache';
import { EmbeddingService } from './embedding.service';
import { PersonaBuilder } from './persona-builder.service';
import {
  type TestDatabaseSetup,
  cleanupTestDatabase,
  getTestPrisma,
  seedTestData,
  setupTestDatabase,
} from './test-setup';

// Cache for BAML responses
const bamlResponseCache = new Map<string, any>();
const promptCache = new PromptCache();

describe('PersonaBuilder - Real Database Integration', () => {
  let service: PersonaBuilder;
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
    service = new PersonaBuilder(prisma, embeddingService);
  });

  afterAll(async () => {
    await testDb.disconnect();
  });

  describe('buildFromConversation - Real BAML Multi-Pass Extraction', () => {
    it('should build persona from conversation using real BAML extraction', async () => {
      const conversation = [
        {
          role: 'user' as const,
          content:
            'I am deeply passionate about artificial intelligence and machine learning. My core identity revolves around solving complex problems through code.',
        },
        {
          role: 'assistant' as const,
          content: "That's fascinating! What aspects of AI interest you most?",
        },
        {
          role: 'user' as const,
          content:
            "I'm particularly drawn to neural networks and deep learning. I love the elegance of mathematical models that can learn patterns. When I speak about AI, I tend to get very animated and use technical jargon.",
        },
        {
          role: 'assistant' as const,
          content:
            'I can hear the excitement in your description! How do you usually approach learning new concepts?',
        },
        {
          role: 'user' as const,
          content:
            'I prefer hands-on experimentation over theoretical study. I want to build systems that can genuinely help people solve real problems. I absolutely refuse to work on AI that could harm anyone or violate privacy.',
        },
      ];

      // This will call real BAML for multi-pass extraction
      const persona = await service.buildFromConversation(conversation);

      expect(persona.id).toBeTruthy();
      expect(persona.name).toBeTruthy();

      // Verify extraction results were stored in database
      const prisma = getTestPrisma();
      const [identityComponents, speechPatterns, desires, boundaries, preferences] =
        await Promise.all([
          prisma.identityComponent.findMany({ where: { personaId: persona.id } }),
          prisma.speechPattern.findMany({ where: { personaId: persona.id } }),
          prisma.desire.findMany({ where: { personaId: persona.id } }),
          prisma.boundary.findMany({ where: { personaId: persona.id } }),
          prisma.preference.findMany({ where: { personaId: persona.id } }),
        ]);

      // Should extract various persona components
      expect(identityComponents.length).toBeGreaterThan(0);
      expect(speechPatterns.length).toBeGreaterThan(0);
      expect(desires.length).toBeGreaterThan(0);
      expect(boundaries.length).toBeGreaterThan(0);
      expect(preferences.length).toBeGreaterThan(0);

      // Verify identity components have proper structure
      identityComponents.forEach((component) => {
        expect(component.componentType).toBeTruthy();
        expect(component.content).toBeTruthy();
        expect(component.importance).toBeGreaterThanOrEqual(0);
        expect(component.importance).toBeLessThanOrEqual(1);
        expect(typeof component.isNegotiable).toBe('boolean');
        expect(component.personaId).toBe(persona.id);
      });

      // Should capture AI/ML identity themes
      const identityContent = identityComponents.map((c) => c.content.toLowerCase()).join(' ');
      expect(
        identityContent.includes('artificial intelligence') ||
          identityContent.includes('machine learning'),
      ).toBe(true);
    });

    it('should handle conversation with different content types and extract accordingly', async () => {
      const mixedConversation = [
        {
          role: 'user' as const,
          content:
            'I have curly brown hair that I often run my fingers through when thinking. My eyes are green with gold flecks.',
        },
        {
          role: 'user' as const,
          content:
            'I deeply value transparency and honesty in all my relationships. I cannot tolerate deception or manipulation.',
        },
        {
          role: 'user' as const,
          content:
            'When I get excited, I speak faster and gesture more. I tend to say "essentially" and "fundamentally" a lot when explaining complex topics.',
        },
        {
          role: 'user' as const,
          content:
            'I desperately want to make a positive impact on the world through my work. I prefer collaborative environments over competitive ones.',
        },
      ];

      const persona = await service.buildFromConversation(mixedConversation);

      const prisma = getTestPrisma();
      const [physical, identity, speech, desires, preferences] = await Promise.all([
        prisma.physicalAttribute.findMany({ where: { personaId: persona.id } }),
        prisma.identityComponent.findMany({ where: { personaId: persona.id } }),
        prisma.speechPattern.findMany({ where: { personaId: persona.id } }),
        prisma.desire.findMany({ where: { personaId: persona.id } }),
        prisma.preference.findMany({ where: { personaId: persona.id } }),
      ]);

      // Should extract across all categories
      expect(physical.length).toBeGreaterThan(0);
      expect(identity.length).toBeGreaterThan(0);
      expect(speech.length).toBeGreaterThan(0);
      expect(desires.length).toBeGreaterThan(0);
      expect(preferences.length).toBeGreaterThan(0);

      // Verify physical attributes
      physical.forEach((attr) => {
        expect(attr.attributeType).toBeTruthy();
        expect(attr.attributeValue).toBeTruthy();
        expect(typeof attr.isPermanent).toBe('boolean');
      });

      // Should capture physical details like hair and eyes
      const physicalContent = physical.map((p) => p.attributeValue.toLowerCase()).join(' ');
      expect(
        physicalContent.includes('brown') ||
          physicalContent.includes('green') ||
          physicalContent.includes('curly'),
      ).toBe(true);
    });
  });

  describe('buildFromDescription - Single Pass Extraction', () => {
    it('should build persona from comprehensive description using real BAML', async () => {
      const description = `
        I am a 28-year-old software engineer with a passion for artificial intelligence and ethical technology development. 
        I have shoulder-length black hair that I usually keep in a messy bun when coding, and dark brown eyes behind wire-frame glasses. 
        I speak with precision and tend to pause thoughtfully before answering difficult questions. 
        I desperately want to contribute to AI safety research and help ensure advanced AI benefits humanity. 
        I absolutely refuse to work on surveillance technology or anything that could violate privacy rights.
        I prefer quiet workspaces with natural light and despise open-plan offices with constant interruptions.
        My core identity is shaped by my belief that technology should empower people, not replace human connection.
      `;

      const persona = await service.buildFromDescription(description);

      expect(persona.id).toBeTruthy();
      expect(persona.name).toBeTruthy();

      // Verify comprehensive extraction
      const prisma = getTestPrisma();
      const [identity, physical, speech, desires, boundaries, preferences] = await Promise.all([
        prisma.identityComponent.findMany({ where: { personaId: persona.id } }),
        prisma.physicalAttribute.findMany({ where: { personaId: persona.id } }),
        prisma.speechPattern.findMany({ where: { personaId: persona.id } }),
        prisma.desire.findMany({ where: { personaId: persona.id } }),
        prisma.boundary.findMany({ where: { personaId: persona.id } }),
        prisma.preference.findMany({ where: { personaId: persona.id } }),
      ]);

      // Should extract from all categories mentioned in description
      expect(identity.length).toBeGreaterThan(0);
      expect(physical.length).toBeGreaterThan(0);
      expect(speech.length).toBeGreaterThan(0);
      expect(desires.length).toBeGreaterThan(0);
      expect(boundaries.length).toBeGreaterThan(0);
      expect(preferences.length).toBeGreaterThan(0);

      // Verify boundaries capture strong refusals
      const strongBoundaries = boundaries.filter((b) => b.firmness > 0.8);
      expect(strongBoundaries.length).toBeGreaterThan(0);

      // Should capture age and profession in identity
      const identityText = identity.map((i) => i.content.toLowerCase()).join(' ');
      expect(identityText.includes('engineer') || identityText.includes('software')).toBe(true);
    });
  });

  describe('BAML Integration - Real LLM Extraction Verification', () => {
    it('should extract identity components using real BAML calls', async () => {
      const identityContent =
        "I define myself through my code. Every algorithm I write feels like an extension of my consciousness. Programming isn't just my job - it's how I think, how I dream, how I express my deepest creativity.";
      const cacheKey = `identity-extraction-${identityContent}`;

      let bamlResult = bamlResponseCache.get(cacheKey);

      if (!bamlResult) {
        bamlResult = await b.ExtractIdentityComponents(identityContent);
        bamlResponseCache.set(cacheKey, bamlResult);

        await promptCache.store(
          'ExtractIdentityComponents_persona_builder_test',
          `Identity Content: ${identityContent}`,
          bamlResult,
        );
      }

      // Verify BAML extraction structure
      expect(bamlResult.components || bamlResult.coreIdentities).toBeTruthy();

      const components = bamlResult.components || bamlResult.coreIdentities || [];
      expect(components.length).toBeGreaterThan(0);

      components.forEach((component: any) => {
        // Handle both possible response formats
        const content = component.content || component.identityLabel;
        const importance = component.importance || component.significance || 0.5;

        expect(content).toBeTruthy();
        expect(typeof importance).toBe('number');
        expect(importance).toBeGreaterThanOrEqual(0);
        expect(importance).toBeLessThanOrEqual(1);
      });
    });

    it('should extract physical attributes using real BAML calls', async () => {
      const physicalContent =
        "I have curly auburn hair that catches the light beautifully. My eyes are a deep emerald green with gold flecks that become more prominent when I'm excited. There's a small scar on my left wrist from a childhood accident.";
      const cacheKey = `physical-extraction-${physicalContent}`;

      let bamlResult = bamlResponseCache.get(cacheKey);

      if (!bamlResult) {
        bamlResult = await b.ExtractPhysicalAttributes(physicalContent);
        bamlResponseCache.set(cacheKey, bamlResult);

        await promptCache.store(
          'ExtractPhysicalAttributes_persona_builder_test',
          `Physical Content: ${physicalContent}`,
          bamlResult,
        );
      }

      // Verify BAML extraction
      expect(bamlResult.physicalAttributes || bamlResult.attributes).toBeTruthy();

      const attributes = bamlResult.physicalAttributes || bamlResult.attributes || [];
      expect(attributes.length).toBeGreaterThan(0);

      attributes.forEach((attr: any) => {
        expect(attr.attributeType || attr.feature).toBeTruthy();
        expect(attr.attributeValue || attr.description).toBeTruthy();
      });
    });

    it('should extract speech patterns using real BAML calls', async () => {
      const speechContent =
        "You know what? I'm totally stoked about this approach! Like, seriously, it's gonna be absolutely game-changing. I mean, we're talking next-level innovation here, folks. This is the kind of breakthrough that makes you go 'holy cow' and just... wow.";
      const cacheKey = `speech-extraction-${speechContent}`;

      let bamlResult = bamlResponseCache.get(cacheKey);

      if (!bamlResult) {
        bamlResult = await b.ExtractSpeechPatterns(speechContent);
        bamlResponseCache.set(cacheKey, bamlResult);

        await promptCache.store(
          'ExtractSpeechPatterns_persona_builder_test',
          `Speech Content: ${speechContent}`,
          bamlResult,
        );
      }

      // Verify BAML extraction
      expect(bamlResult.speechPatterns || bamlResult.patterns).toBeTruthy();

      const patterns = bamlResult.speechPatterns || bamlResult.patterns || [];
      expect(patterns.length).toBeGreaterThan(0);

      patterns.forEach((pattern: any) => {
        expect(pattern.patternType || pattern.type).toBeTruthy();
        expect(pattern.textPattern || pattern.pattern).toBeTruthy();
        expect(typeof (pattern.frequency || 0.5)).toBe('number');
      });
    });

    it('should extract desires and boundaries using real BAML calls', async () => {
      const desireContent =
        'I desperately want to build AI systems that genuinely help people solve real problems. I absolutely refuse to work on anything that could harm individuals or violate their privacy. I crave intellectual challenges and meaningful collaboration.';
      const cacheKey = `desires-extraction-${desireContent}`;

      let bamlResult = bamlResponseCache.get(cacheKey);

      if (!bamlResult) {
        bamlResult = await b.ExtractDesiresAndBoundaries(desireContent);
        bamlResponseCache.set(cacheKey, bamlResult);

        await promptCache.store(
          'ExtractDesiresAndBoundaries_persona_builder_test',
          `Desires Content: ${desireContent}`,
          bamlResult,
        );
      }

      // Verify BAML extraction
      expect(bamlResult.desires || bamlResult.boundaries || bamlResult.motivations).toBeTruthy();

      // Check desires
      const desires = bamlResult.desires || bamlResult.motivations || [];
      if (desires.length > 0) {
        desires.forEach((desire: any) => {
          expect(desire.content || desire.description).toBeTruthy();
          expect(typeof (desire.intensity || desire.strength || 0.5)).toBe('number');
        });
      }

      // Check boundaries
      const boundaries = bamlResult.boundaries || [];
      if (boundaries.length > 0) {
        boundaries.forEach((boundary: any) => {
          expect(boundary.content || boundary.description).toBeTruthy();
          expect(typeof (boundary.firmness || boundary.strength || 0.5)).toBe('number');
        });
      }
    });
  });

  describe('Data Storage and Retrieval', () => {
    it('should store extracted data with proper relationships and constraints', async () => {
      const persona = await service.buildFromDescription(
        'I am a creative problem-solver who values honesty. I have brown hair and speak directly. I want to help others and prefer quiet environments.',
      );

      const prisma = getTestPrisma();

      // Verify all components have correct persona relationship
      const [identity, physical, speech, desires, preferences] = await Promise.all([
        prisma.identityComponent.findMany({ where: { personaId: persona.id } }),
        prisma.physicalAttribute.findMany({ where: { personaId: persona.id } }),
        prisma.speechPattern.findMany({ where: { personaId: persona.id } }),
        prisma.desire.findMany({ where: { personaId: persona.id } }),
        prisma.preference.findMany({ where: { personaId: persona.id } }),
      ]);

      // All components should have valid personaId
      [...identity, ...physical, ...speech, ...desires, ...preferences].forEach((component) => {
        expect(component.personaId).toBe(persona.id);
      });

      // Verify data constraints
      identity.forEach((comp) => {
        expect(comp.importance).toBeGreaterThanOrEqual(0);
        expect(comp.importance).toBeLessThanOrEqual(1);
      });

      speech.forEach((pattern) => {
        expect(pattern.frequency).toBeGreaterThanOrEqual(0);
        expect(pattern.frequency).toBeLessThanOrEqual(1);
      });

      desires.forEach((desire) => {
        expect(desire.currentIntensity).toBeGreaterThanOrEqual(0);
        expect(desire.currentIntensity).toBeLessThanOrEqual(1);
        expect(desire.fulfillmentLevel).toBeGreaterThanOrEqual(0);
        expect(desire.fulfillmentLevel).toBeLessThanOrEqual(1);
      });
    });

    it('should handle persona updates and avoid duplicate data', async () => {
      // Build initial persona
      const persona1 = await service.buildFromDescription(
        'I am a software engineer who loves coding.',
      );

      // Build updated persona with additional info
      const persona2 = await service.buildFromDescription(
        'I am a software engineer who loves coding and also enjoys painting in my free time.',
      );

      const prisma = getTestPrisma();

      // Should create separate personas, not update existing
      expect(persona1.id).not.toBe(persona2.id);

      const identityComponents1 = await prisma.identityComponent.findMany({
        where: { personaId: persona1.id },
      });
      const identityComponents2 = await prisma.identityComponent.findMany({
        where: { personaId: persona2.id },
      });

      expect(identityComponents1.length).toBeGreaterThan(0);
      expect(identityComponents2.length).toBeGreaterThan(0);

      // Each persona should have distinct components
      identityComponents1.forEach((comp) => expect(comp.personaId).toBe(persona1.id));
      identityComponents2.forEach((comp) => expect(comp.personaId).toBe(persona2.id));
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty or minimal conversation gracefully', async () => {
      const minimalConversation = [
        { role: 'user' as const, content: 'Hi' },
        { role: 'assistant' as const, content: 'Hello' },
      ];

      const persona = await service.buildFromConversation(minimalConversation);

      expect(persona.id).toBeTruthy();
      expect(persona.name).toBeTruthy();

      // Should still create a valid persona even with minimal data
      const prisma = getTestPrisma();
      const dbPersona = await prisma.persona.findUnique({
        where: { id: persona.id },
      });

      expect(dbPersona).toBeTruthy();
    });

    it('should handle very long descriptions without errors', async () => {
      const longDescription =
        'I am a person. '.repeat(1000) + 'I love programming and have brown hair.';

      const persona = await service.buildFromDescription(longDescription);

      expect(persona.id).toBeTruthy();

      // Should extract meaningful components despite length
      const prisma = getTestPrisma();
      const components = await prisma.identityComponent.findMany({
        where: { personaId: persona.id },
      });

      expect(components.length).toBeGreaterThan(0);
    });

    it('should maintain database integrity with concurrent persona building', async () => {
      const descriptions = Array.from(
        { length: 3 },
        (_, i) => `I am person ${i} with unique characteristics and interests in field ${i}.`,
      );

      // Build personas concurrently
      const personaPromises = descriptions.map((desc) => service.buildFromDescription(desc));

      const personas = await Promise.all(personaPromises);

      // All should succeed and be unique
      expect(personas.length).toBe(3);
      const uniqueIds = new Set(personas.map((p) => p.id));
      expect(uniqueIds.size).toBe(3);

      // Verify all in database
      const prisma = getTestPrisma();
      const dbPersonas = await prisma.persona.findMany({
        where: { id: { in: personas.map((p) => p.id) } },
      });

      expect(dbPersonas.length).toBe(3);
    });
  });
});
