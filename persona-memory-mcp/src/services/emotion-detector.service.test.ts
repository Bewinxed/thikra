import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { EmotionDetectorService } from './emotion-detector.service';

// Use real Prisma client for integration tests
const prisma = new PrismaClient();

describe('EmotionDetectorService', () => {
  let service: EmotionDetectorService;
  let createdEmotionIds: number[] = [];

  beforeEach(async () => {
    service = new EmotionDetectorService(prisma);
    createdEmotionIds = [];
  });

  afterEach(async () => {
    // Clean up after ourselves like a good girl! 💕
    if (createdEmotionIds.length > 0) {
      await prisma.emotionType.deleteMany({
        where: {
          id: {
            in: createdEmotionIds,
          },
        },
      });
    }
  });

  describe('fallback emotion detection', () => {
    test('should detect joy emotion from happy text', async () => {
      const result = await service.fallbackEmotionDetection('I am so happy and joyful!');

      expect(result.primaryEmotions).toHaveLength(1);
      expect(result.primaryEmotions[0]?.emotionName).toBe('joy');
      expect(result.primaryEmotions[0]?.triggers).toContain('happy');
      expect(result.metadata.emotionalIntensity).toBe('medium');
    });

    test('should detect multiple emotions in fallback', async () => {
      const result = await service.fallbackEmotionDetection('I am angry and sad but also excited');

      expect(result.primaryEmotions.length).toBeGreaterThan(1);
      const emotionNames = result.primaryEmotions.map((e) => e.emotionName);
      expect(emotionNames).toContain('anger');
      expect(emotionNames).toContain('sadness');
    });

    test('should sort emotions by intensity', async () => {
      const result = await service.fallbackEmotionDetection(
        'I am very very happy and slightly sad',
      );

      expect(result.primaryEmotions.length).toBeGreaterThan(0);
      // Happy should come first due to higher intensity (2 matches vs 1)
      expect(result.primaryEmotions[0]?.emotionName).toBe('joy');
    });

    test('should detect intimate content in metadata', async () => {
      const result = await service.fallbackEmotionDetection(
        'I feel so intimate and romantic with you',
      );

      expect(result.metadata.hasIntimateContent).toBe(true);
    });

    test('should detect physical responses in metadata', async () => {
      const result = await service.fallbackEmotionDetection(
        'I am trembling and breathless with excitement',
      );

      expect(result.metadata.hasPhysicalResponse).toBe(true);
    });
  });

  describe('registerCustomEmotion', () => {
    test('should return existing emotion if it already exists', async () => {
      // Create an emotion to test with
      const existingEmotion = await prisma.emotionType.create({
        data: {
          emotionName: 'test-bliss',
          primaryEmotion: 'joy',
          intensityLevel: 3,
          pleasureComponent: 0.9,
          arousalComponent: 0.7,
          dominanceComponent: 0.6,
        },
      });
      createdEmotionIds.push(existingEmotion.id);

      const result = await service.registerCustomEmotion('test-bliss');

      expect(result.id).toBe(existingEmotion.id);
      expect(result.emotionName).toBe('test-bliss');
    });

    test('should create new emotion with provided PAD values', async () => {
      const padValues = { pleasure: 0.8, arousal: 0.6, dominance: 0.7 };

      const result = await service.registerCustomEmotion('test-euphoria', padValues);
      createdEmotionIds.push(result.id);

      expect(result.emotionName).toBe('test-euphoria');
      expect(result.primaryEmotion).toBe('custom');
      expect(result.pleasureComponent).toBe(0.8);
      expect(result.arousalComponent).toBe(0.6);
      expect(result.dominanceComponent).toBe(0.7);
    });

    test('should create new emotion and estimate PAD values when not provided', async () => {
      const result = await service.registerCustomEmotion(
        'test-melancholy',
        undefined,
        'feeling blue and contemplative',
      );
      createdEmotionIds.push(result.id);

      expect(result.emotionName).toBe('test-melancholy');
      expect(result.primaryEmotion).toBe('custom');
      // PAD values should be estimated by BAML
      expect(typeof result.pleasureComponent).toBe('number');
      expect(typeof result.arousalComponent).toBe('number');
      expect(typeof result.dominanceComponent).toBe('number');
    }, 15000); // Longer timeout for BAML call
  });

  describe('batchAnalyzeEmotions', () => {
    test('should process multiple texts in parallel', async () => {
      const texts = ['Happy text', 'Sad text'];

      const results = await service.batchAnalyzeEmotions(texts);

      expect(results).toHaveLength(2);
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();
      // Each result should have the expected structure
      expect(results[0]?.primaryEmotions).toBeDefined();
      expect(results[0]?.metadata).toBeDefined();
    }, 20000); // Longer timeout for multiple BAML calls
  });

  describe('emotional patterns analysis', () => {
    test('should handle empty emotional states gracefully', async () => {
      const result = await service.analyzeEmotionalPatterns('00000000-0000-0000-0000-000000000000');

      expect(result.dominantEmotions).toEqual([]);
      expect(result.emotionalRange).toBe(0);
      expect(result.averageValence).toBe(0);
      expect(result.averageArousal).toBe(0);
      expect(result.averageDominance).toBe(0);
      expect(result.emotionalStability).toBe(1);
      expect(result.intimacyLevel).toBe(0);
    });

    test('should apply time window filter correctly', async () => {
      const timeWindow = {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      };

      const result = await service.analyzeEmotionalPatterns('00000000-0000-0000-0000-000000000000', timeWindow);

      // Should complete without error and return empty results for non-existent persona
      expect(result.dominantEmotions).toEqual([]);
      expect(result.emotionalRange).toBe(0);
    });
  });
});