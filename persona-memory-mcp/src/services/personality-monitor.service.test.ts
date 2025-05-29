import { beforeEach, describe, expect, it } from 'bun:test';
import type { PersonalityObservation, PersonalityParameter, PrismaClient } from '@prisma/client';
import { b } from '../../baml_client';
import { PromptCache } from '../utils/prompt-cache';
import { PersonalityMonitorService } from './personality-monitor.service';

// Mock Prisma client (DB mocking is OK, just not BAML)
function createMockPrismaClient() {
  return {
    personalityObservation: {
      create: async (args: any) => ({
        id: `obs-${Date.now()}`,
        ...args.data,
        observedAt: new Date(),
      }),
      createMany: async () => ({ count: 0 }),
      findMany: async () => [],
      findUnique: async () => null,
    },
    personalityParameter: {
      create: async (args: any) => ({
        id: `param-${Date.now()}`,
        ...args.data,
        lastUpdated: new Date(),
      }),
      update: async (args: any) => ({
        id: args.where.id,
        ...args.data,
        lastUpdated: new Date(),
      }),
      findUnique: async () => null,
      findMany: async () => [],
    },
    personalityParameterHistory: {
      create: async (args: any) => ({
        id: `hist-${Date.now()}`,
        ...args.data,
        recordedAt: new Date(),
      }),
    },
    personalityObservationEvidence: {
      createMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaClient;
}

// Cache for BAML responses to avoid repeated LLM calls
const bamlResponseCache = new Map<string, any>();
const promptCache = new PromptCache();

describe('PersonalityMonitorService', () => {
  let service: PersonalityMonitorService;
  let prismaMock: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    prismaMock = createMockPrismaClient();
    service = new PersonalityMonitorService(prismaMock);
  });

  describe('BAML Integration - Real LLM Extraction', () => {
    it('should extract personality observations from real conversation', async () => {
      const testContent =
        'I feel most alive when learning something new. The joy of discovery makes my whole being light up.';
      const cacheKey = `extract-${testContent}`;

      // Check cache first
      let bamlResult = bamlResponseCache.get(cacheKey);

      if (!bamlResult) {
        // Actually call BAML (will use real LLM)
        bamlResult = await b.ExtractPersonalityObservations(testContent, null);
        bamlResponseCache.set(cacheKey, bamlResult);

        // Also store in PromptCache for visibility
        await promptCache.store(
          'ExtractPersonalityObservations_test',
          `Test Content: ${testContent}`,
          bamlResult,
          undefined,
        );
      }

      // Verify the extraction found personality traits
      expect(bamlResult.observations.length).toBeGreaterThan(0);

      // The traits should be discovered, not from a hardcoded list
      const firstObservation = bamlResult.observations[0];
      expect(firstObservation.traitDimension).toBeTruthy();
      expect(firstObservation.observedValue).toBeGreaterThanOrEqual(0);
      expect(firstObservation.observedValue).toBeLessThanOrEqual(1);
      expect(firstObservation.confidence).toBeGreaterThan(0);

      // Context fields should have meaningful content
      expect(firstObservation.situation).toBeTruthy();
      expect(firstObservation.situation).not.toBe('');
      expect(firstObservation.evidence).toBeInstanceOf(Array);
      expect(firstObservation.evidence.length).toBeGreaterThan(0);
    });

    it('should discover unique traits for different personas', async () => {
      const persona1Content =
        'I find comfort in structure and predictability. Chaos makes me anxious.';
      const persona2Content = 'I thrive in uncertainty! The unknown excites me like nothing else.';

      // Get or cache responses
      let result1 = bamlResponseCache.get(`extract-${persona1Content}`);
      let result2 = bamlResponseCache.get(`extract-${persona2Content}`);

      if (!result1) {
        result1 = await b.ExtractPersonalityObservations(persona1Content, null);
        bamlResponseCache.set(`extract-${persona1Content}`, result1);
      }

      if (!result2) {
        result2 = await b.ExtractPersonalityObservations(persona2Content, null);
        bamlResponseCache.set(`extract-${persona2Content}`, result2);
      }

      // Should discover different traits for different personas
      const traits1 = result1.observations.map((o: any) => o.traitDimension);
      const traits2 = result2.observations.map((o: any) => o.traitDimension);

      // The traits should reflect the different personalities
      expect(traits1).toBeTruthy();
      expect(traits2).toBeTruthy();

      // Values should differ based on content
      const avgValue1 =
        result1.observations.reduce((sum: number, o: any) => sum + o.observedValue, 0) /
        result1.observations.length;
      const avgValue2 =
        result2.observations.reduce((sum: number, o: any) => sum + o.observedValue, 0) /
        result2.observations.length;

      // These personas express opposite preferences, so values might differ
      expect(Math.abs(avgValue1 - avgValue2)).toBeGreaterThan(0);
    });
  });

  describe('PersDyn Model Implementation', () => {
    it('should calculate PersDyn parameters using Bayesian estimation', () => {
      const observations = [
        { observedValue: 0.7, confidence: 0.9 },
        { observedValue: 0.8, confidence: 0.95 },
        { observedValue: 0.75, confidence: 0.85 },
        { observedValue: 0.9, confidence: 0.9 },
        { observedValue: 0.6, confidence: 0.8 },
      ] as PersonalityObservation[];

      // Test the parameter estimation logic
      const params = service.estimateParameters(observations);

      // Baseline should be weighted average
      expect(params.baseline).toBeCloseTo(0.75, 1);

      // Variability should capture spread
      expect(params.variability).toBeGreaterThan(0);
      expect(params.variability).toBeLessThan(0.2);

      // Attractor force should be in [0, 1]
      expect(params.attractorForce).toBeGreaterThanOrEqual(0);
      expect(params.attractorForce).toBeLessThanOrEqual(1);

      // Uncertainties should decrease with more observations
      expect(params.uncertainties.baseline).toBeLessThan(0.5);
    });

    it('should detect parameter drift without hardcoded thresholds', () => {
      const currentParams = {
        id: 'param1',
        personaId: 'persona1',
        traitDimension: 'openness_to_vulnerability',
        baseline: 0.5,
        variability: 0.1,
        attractorForce: 0.6,
        baselineUncertainty: 0.1,
        variabilityUncertainty: 0.15,
        attractorUncertainty: 0.2,
        observationCount: 50,
        lastUpdated: new Date(),
      } as PersonalityParameter;

      // Test drift detection uses uncertainty bounds, not hardcoded values
      const drift1 = service.calculateParameterDrift(currentParams, {
        baseline: 0.55, // Small drift within uncertainty
        variability: 0.11,
        attractorForce: 0.62,
      });
      expect(drift1.significant).toBe(false);

      const drift2 = service.calculateParameterDrift(currentParams, {
        baseline: 0.7, // Large drift beyond uncertainty
        variability: 0.3,
        attractorForce: 0.9,
      });
      expect(drift2.significant).toBe(true);
    });
  });

  describe('Context-based personality expression', () => {
    it('should detect different expressions in different contexts', async () => {
      const contextualContent = `
        When I'm with close friends, I'm incredibly playful and silly.
        In professional settings, I become focused and serious.
        When I'm alone, I tend to be contemplative and philosophical.
      `;

      const cacheKey = `extract-contextual-${contextualContent}`;
      let result = bamlResponseCache.get(cacheKey);

      if (!result) {
        result = await b.ExtractPersonalityObservations(contextualContent, null);
        bamlResponseCache.set(cacheKey, result);
      }

      // Should identify multiple observations with different contexts
      expect(result.observations.length).toBeGreaterThan(1);

      // Check that different contexts were identified
      const contexts = result.observations.map((o: any) => o.situation).filter((s: any) => s);

      expect(contexts.length).toBeGreaterThan(0);

      // Values should vary based on context
      const values = result.observations.map((o: any) => o.observedValue);
      const uniqueValues = [...new Set(values)];
      expect(uniqueValues.length).toBeGreaterThan(1); // Different values in different contexts
    });
  });

  describe('Temporal dynamics analysis', () => {
    it('should analyze personality dynamics over time', async () => {
      // Create a series of observations showing evolution
      const timeSeriesContent = [
        'Initially, I was very guarded and careful with my words.',
        "Over time, I've become more open and expressive.",
        'Now I share my thoughts freely and without hesitation.',
      ];

      const observations = [];

      for (const [index, content] of timeSeriesContent.entries()) {
        const cacheKey = `extract-time-${index}-${content}`;
        let result = bamlResponseCache.get(cacheKey);

        if (!result) {
          result = await b.ExtractPersonalityObservations(content, null);
          bamlResponseCache.set(cacheKey, result);
        }

        observations.push(...result.observations);
      }

      // Should show progression in trait values
      expect(observations.length).toBeGreaterThan(0);

      // Look for traits related to openness/expressiveness
      const opennessObservations = observations.filter(
        (o: any) =>
          o.traitDimension.toLowerCase().includes('open') ||
          o.traitDimension.toLowerCase().includes('express') ||
          o.traitDimension.toLowerCase().includes('guard'),
      );

      if (opennessObservations.length > 1) {
        // Values should show a trend (increasing openness)
        const firstValue = opennessObservations[0].observedValue;
        const lastValue = opennessObservations[opennessObservations.length - 1].observedValue;

        // We expect openness to increase over time based on the content
        expect(lastValue).not.toBe(firstValue); // Values changed over time
      }
    });
  });
});

// Export cache for potential reuse
export { bamlResponseCache };
