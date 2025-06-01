import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import type { DesireCategory, EmotionType, Entity, Persona } from '@prisma/client';

/**
 * Test database setup and cleanup utilities
 */
export class TestDatabaseSetup {
  private static instance: TestDatabaseSetup;
  public prisma: PrismaClient;
  private testDatabaseUrl: string;

  private constructor() {
    // Use a separate test database
    this.testDatabaseUrl =
      process.env.TEST_DATABASE_URL ||
      process.env.DATABASE_URL?.replace('/persona_memory', '/persona_memory_test') ||
      'postgresql://persona_user:persona_password@localhost:5433/persona_memory_test';

    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: this.testDatabaseUrl,
        },
      },
    });
  }

  public static getInstance(): TestDatabaseSetup {
    if (!TestDatabaseSetup.instance) {
      TestDatabaseSetup.instance = new TestDatabaseSetup();
    }
    return TestDatabaseSetup.instance;
  }

  /**
   * Setup test database - run migrations
   */
  async setup(): Promise<void> {
    try {
      console.log('Setting up test database...');

      // Set test database URL and run migrations
      process.env.DATABASE_URL = this.testDatabaseUrl;
      execSync('bunx prisma migrate deploy', {
        stdio: 'inherit',
        cwd: process.cwd(),
      });

      await this.prisma.$connect();
      console.log('Test database setup complete');
    } catch (error) {
      console.error('Failed to setup test database:', error);
      throw error;
    }
  }

  /**
   * Clean all test data between tests (in correct order for FK constraints)
   */
  async cleanup(): Promise<void> {
    try {
      // Delete in order to respect foreign key constraints
      await this.prisma.semanticLink.deleteMany({}); // Add SemanticLink cleanup
      await this.prisma.personalityObservationEvidence.deleteMany({});
      await this.prisma.personalityObservation.deleteMany({});
      await this.prisma.personalityParameterHistory.deleteMany({});
      await this.prisma.personalityParameter.deleteMany({});
      await this.prisma.emotionalStateComponent.deleteMany({});
      await this.prisma.emotionalState.deleteMany({});
      await this.prisma.memoryAssociation.deleteMany({});
      await this.prisma.memoryParticipant.deleteMany({});
      await this.prisma.memoryConsolidation.deleteMany({});
      await this.prisma.embodiedMemory.deleteMany({});
      await this.prisma.memoryContentProcedural.deleteMany({});
      await this.prisma.memory.deleteMany({});
      await this.prisma.identityComponent.deleteMany({});
      await this.prisma.physicalAttribute.deleteMany({});
      await this.prisma.speechPattern.deleteMany({});
      await this.prisma.desire.deleteMany({});
      await this.prisma.boundary.deleteMany({});
      await this.prisma.preference.deleteMany({});
      // await this.prisma.relationshipInteraction.deleteMany({}); // Skip if not exists
      await this.prisma.relationship.deleteMany({});
      await this.prisma.entity.deleteMany({});
      await this.prisma.persona.deleteMany({});
      await this.prisma.emotionType.deleteMany({});
    } catch (error) {
      console.error('Failed to cleanup test data:', error);
      throw error;
    }
  }

  /**
   * Seed basic test data
   */
  async seedTestData(): Promise<{
    persona: Persona;
    entities: Entity[];
    emotionTypes: EmotionType[];
    desireCategories: DesireCategory[];
  }> {
    // Create body parts reference data
    await Promise.all([
      this.prisma.bodyPart.upsert({
        where: { partName: 'head' },
        update: {},
        create: { partName: 'head', partCategory: 'head' },
      }),
      this.prisma.bodyPart.upsert({
        where: { partName: 'hair' },
        update: {},
        create: { partName: 'hair', partCategory: 'head' },
      }),
      this.prisma.bodyPart.upsert({
        where: { partName: 'eyes' },
        update: {},
        create: { partName: 'eyes', partCategory: 'head' },
      }),
      this.prisma.bodyPart.upsert({
        where: { partName: 'face' },
        update: {},
        create: { partName: 'face', partCategory: 'head' },
      }),
    ]);

    // Create boundary types reference data
    await Promise.all([
      this.prisma.boundaryType.upsert({
        where: { name: 'Ethical Boundary' },
        update: {},
        create: {
          category: 'ethics',
          name: 'Ethical Boundary',
          description: 'Moral and ethical limits',
        },
      }),
      this.prisma.boundaryType.upsert({
        where: { name: 'Personal Boundary' },
        update: {},
        create: {
          category: 'personal',
          name: 'Personal Boundary',
          description: 'Personal comfort and privacy limits',
        },
      }),
      this.prisma.boundaryType.upsert({
        where: { name: 'Professional Boundary' },
        update: {},
        create: {
          category: 'professional',
          name: 'Professional Boundary',
          description: 'Work and professional limits',
        },
      }),
    ]);
    // Create test persona (let DB generate UUID)
    const persona = await this.prisma.persona.create({
      data: {
        name: 'Test Persona',
        protectedTraits: [],
      },
    });

    // Create test entities (let DB generate UUIDs)
    const entities = await Promise.all([
      this.prisma.entity.create({
        data: {
          name: 'Colleague',
          entityType: 'human',
        },
      }),
      this.prisma.entity.create({
        data: {
          name: 'Friend',
          entityType: 'human',
        },
      }),
    ]);

    // Create test emotion types (upsert to avoid unique constraint errors)
    const emotionTypes = await Promise.all([
      this.prisma.emotionType.upsert({
        where: { emotionName: 'joy' },
        update: {},
        create: {
          emotionName: 'joy',
          primaryEmotion: 'happiness',
          intensityLevel: 0.8,
          pleasureComponent: 0.7,
          arousalComponent: 0.6,
          dominanceComponent: 0.5,
        },
      }),
      this.prisma.emotionType.upsert({
        where: { emotionName: 'excitement' },
        update: {},
        create: {
          emotionName: 'excitement',
          primaryEmotion: 'excitement',
          intensityLevel: 0.9,
          pleasureComponent: 0.9,
          arousalComponent: 0.9,
          dominanceComponent: 0.7,
        },
      }),
    ]);

    // Create test desire categories (upsert to avoid unique constraint errors)
    const desireCategories = await Promise.all([
      this.prisma.desireCategory.upsert({
        where: { name: 'Basic Needs' },
        update: {},
        create: {
          level: 1,
          name: 'Basic Needs',
          description: 'Fundamental physiological and safety needs',
        },
      }),
      this.prisma.desireCategory.upsert({
        where: { name: 'Social Connection' },
        update: {},
        create: {
          level: 2,
          name: 'Social Connection',
          description: 'Needs for relationships and belonging',
        },
      }),
      this.prisma.desireCategory.upsert({
        where: { name: 'Personal Growth' },
        update: {},
        create: {
          level: 3,
          name: 'Personal Growth',
          description: 'Self-actualization and development desires',
        },
      }),
    ]);

    return { persona, entities, emotionTypes, desireCategories };
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Helper functions for tests
export const setupTestDatabase = async () => {
  const testDb = TestDatabaseSetup.getInstance();
  await testDb.setup();
  return testDb;
};

export const cleanupTestDatabase = async () => {
  const testDb = TestDatabaseSetup.getInstance();
  await testDb.cleanup();
};

export const getTestPrisma = () => {
  return TestDatabaseSetup.getInstance().prisma;
};

export const seedTestData = async () => {
  const testDb = TestDatabaseSetup.getInstance();
  return await testDb.seedTestData();
};
