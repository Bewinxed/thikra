import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { EmbeddingService } from './embedding.service';
import { LLMService } from './llm.service';
import { PersonaBuilder } from './persona-builder.service';

/**
 * PersonaBuilder Service Tests
 *
 * Tests ONLY PersonaBuilder functionality:
 * - Personality template generation (archetype and text)
 * - Multi-pass extraction
 * - Trait extraction and mapping
 * - Template caching and retrieval
 *
 * Does NOT test MCP integration or decision influence - those belong in other test modules.
 */

describe('PersonaBuilder Service', () => {
  let prisma: PrismaClient;
  let personaBuilder: PersonaBuilder;
  let embeddingService: EmbeddingService;
  let llmService: LLMService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    embeddingService = new EmbeddingService();
    llmService = new LLMService();
    personaBuilder = new PersonaBuilder(prisma, embeddingService, llmService);
  }, 60000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  test('persona extraction from conversation creates traits', async () => {
    const mysteriousConversation = [
      {
        role: 'assistant' as const,
        content: `I find myself drawn to the shadows and complexity of life. 
        There's something beautiful about the unknown, the unspoken truths 
        that lie beneath surface conversations. I prefer to observe first, 
        speak only when my words will have meaning. People often tell me 
        I'm enigmatic, that they can't quite figure me out - and I like it that way.`,
        timestamp: new Date(),
      },
    ];

    const persona = await personaBuilder.buildFromConversation(mysteriousConversation);

    expect(persona).toBeDefined();
    expect(persona.name).toBeDefined();

    // Check that personality traits were extracted
    const traits = await prisma.personalityTrait.findMany({
      where: { personaId: persona.id },
    });

    expect(traits.length).toBeGreaterThan(0);

    // Should extract personality-related traits
    const traitNames = traits.map((t) => t.traitName.toLowerCase());
    const mysteriousTerms = ['mysterious', 'observant', 'complex', 'introspective'];
    const hasRelevantTraits = mysteriousTerms.some((term) =>
      traitNames.some((name) => name.includes(term)),
    );
    expect(hasRelevantTraits).toBe(true);
  }, 60000);

  test('persona extraction from technical description', async () => {
    const technicalConversation = [
      {
        role: 'assistant' as const,
        content: `I'm a software engineer who loves solving complex algorithms. 
        I get excited about clean code architecture and spend my evenings 
        contributing to open source projects. I'm methodical in my approach 
        and believe in testing everything thoroughly. My colleagues know me 
        as the person who always asks the detailed technical questions.`,
        timestamp: new Date(),
      },
    ];

    const persona = await personaBuilder.buildFromConversation(technicalConversation);

    expect(persona).toBeDefined();

    // Check identity components
    const identities = await prisma.identityComponent.findMany({
      where: { personaId: persona.id },
    });

    const hasTechnicalIdentity = identities.some(
      (i) =>
        i.content.toLowerCase().includes('engineer') ||
        i.content.toLowerCase().includes('technical'),
    );
    expect(hasTechnicalIdentity).toBe(true);
  }, 60000);

  test('buildFromConversation creates database records', async () => {
    const conversation = [
      {
        role: 'assistant' as const,
        content: "I'm usually pretty quiet and prefer to observe rather than speak up.",
        timestamp: new Date(),
      },
    ];

    const persona = await personaBuilder.buildFromConversation(conversation);

    expect(persona).toBeDefined();
    expect(persona.id).toBeDefined();

    // Should have extracted some traits
    const traits = await prisma.personalityTrait.findMany({
      where: { personaId: persona.id },
    });
    expect(traits.length).toBeGreaterThan(0);
  }, 60000);

  test('multi-pass extraction completeness', async () => {
    const richConversation = [
      {
        role: 'assistant' as const,
        content: `Hi there! I'm Alex, a 29-year-old creative director who absolutely loves designing 
        user experiences that make people smile. I have curly brown hair and bright green eyes 
        that light up when I talk about my projects. I tend to gesture a lot when I'm excited - 
        which is pretty much always when discussing design! I believe deeply in accessibility 
        and inclusive design. My biggest desire is to create digital experiences that feel 
        genuinely human and warm.`,
        timestamp: new Date(),
      },
    ];

    const persona = await personaBuilder.buildFromConversation(richConversation);

    expect(persona).toBeDefined();

    // Check multiple types of extraction
    const identities = await prisma.identityComponent.findMany({
      where: { personaId: persona.id },
    });

    const physicalAttrs = await prisma.physicalAttribute.findMany({
      where: { personaId: persona.id },
    });

    const traits = await prisma.personalityTrait.findMany({
      where: { personaId: persona.id },
    });

    expect(identities.length).toBeGreaterThan(0);
    expect(physicalAttrs.length).toBeGreaterThan(0);
    expect(traits.length).toBeGreaterThan(0);

    // Should have extracted name/identity
    const hasNameInfo = identities.some(
      (ic) =>
        ic.content.toLowerCase().includes('alex') ||
        ic.content.toLowerCase().includes('creative director'),
    );
    expect(hasNameInfo).toBe(true);
  }, 60000);
});
