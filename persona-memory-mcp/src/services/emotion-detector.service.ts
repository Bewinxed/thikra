import type { EmotionType, PrismaClient } from '@prisma/client';
import { b } from '../../baml_client';
import type {
  DetectedEmotion,
  EmotionAnalysis,
  EmotionMetadata,
  EmotionalTransition,
  PADValues,
} from '../../baml_client/types';

interface DetectedEmotionWithId extends DetectedEmotion {
  emotionTypeId?: string;
}

export class EmotionDetectorService {
  private emotionCache: Map<string, EmotionType> = new Map();

  constructor(private prisma: PrismaClient) {
    this.loadEmotionTypes();
  }

  /**
   * Load emotion types from database into cache
   */
  private async loadEmotionTypes() {
    const emotions = await this.prisma.emotionType.findMany();
    for (const emotion of emotions) {
      this.emotionCache.set(emotion.emotionName.toLowerCase(), emotion);
    }
  }

  /**
   * Detect emotions in text using LLM
   */
  async detectEmotions(text: string): Promise<EmotionAnalysis> {
    try {
      // Use BAML function to analyze emotions
      const analysis = await b.AnalyzeEmotions(text);

      // Map detected emotions to database IDs
      const enrichedAnalysis = await this.enrichEmotionAnalysis(analysis);

      return enrichedAnalysis;
    } catch (error) {
      console.error('Error detecting emotions:', error);
      // Fallback to basic analysis
      return this.fallbackEmotionDetection(text);
    }
  }

  /**
   * Enrich emotion analysis with database IDs and create custom emotions if needed
   */
  private async enrichEmotionAnalysis(analysis: EmotionAnalysis): Promise<EmotionAnalysis> {
    // Process primary emotions
    for (const emotion of analysis.primaryEmotions) {
      await this.enrichDetectedEmotion(emotion);
    }

    // Process secondary emotions
    for (const emotion of analysis.secondaryEmotions) {
      await this.enrichDetectedEmotion(emotion);
    }

    // Register any custom emotions
    for (const customEmotionName of analysis.customEmotions) {
      await this.registerCustomEmotion(
        customEmotionName,
        analysis.padValues,
        '', // No context for custom emotions from analysis
      );
    }

    return analysis;
  }

  /**
   * Enrich a single detected emotion with database information
   */
  private async enrichDetectedEmotion(emotion: DetectedEmotion): Promise<void> {
    const dbEmotion = this.emotionCache.get(emotion.emotionName.toLowerCase());

    if (dbEmotion) {
      // Add database ID to the emotion object
      const emotionWithId = emotion as DetectedEmotionWithId;
      emotionWithId.emotionTypeId = dbEmotion.id.toString();
    } else if (emotion.isCustom) {
      // Create custom emotion in database
      const newEmotion = await this.registerCustomEmotion(
        emotion.emotionName,
        undefined, // Will estimate from context
        emotion.context || '',
      );
      const emotionWithId = emotion as DetectedEmotionWithId;
      emotionWithId.emotionTypeId = newEmotion.id.toString();
    }
  }

  /**
   * Detect emotional transitions in a conversation
   */
  async detectEmotionalTransitions(messages: { content: string; timestamp: Date }[]): Promise<{
    transitions: EmotionalTransition[];
    emotionalJourney: Array<{
      timestamp: Date;
      dominantEmotion: string;
      intensity: number;
      padValues: PADValues;
    }>;
  }> {
    // Extract just the message content
    const messageContents = messages.map((m) => m.content);

    // Use BAML to detect transitions
    const transitions = await b.ExtractEmotionalJourney(messageContents);

    // Build emotional journey by analyzing each message
    const emotionalJourney = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;

      const analysis = await this.detectEmotions(msg.content);

      if (analysis.primaryEmotions.length > 0) {
        const primaryEmotion = analysis.primaryEmotions[0];
        if (primaryEmotion) {
          emotionalJourney.push({
            timestamp: msg.timestamp,
            dominantEmotion: primaryEmotion.emotionName,
            intensity: primaryEmotion.intensity,
            padValues: analysis.padValues,
          });
        }
      }
    }

    return { transitions, emotionalJourney };
  }

  /**
   * Analyze emotional patterns for a persona
   */
  async analyzeEmotionalPatterns(
    personaId: string,
    timeWindow?: { start: Date; end: Date },
  ): Promise<{
    dominantEmotions: Array<{ emotion: string; frequency: number; avgIntensity: number }>;
    emotionalRange: number;
    averageValence: number;
    averageArousal: number;
    averageDominance: number;
    emotionalStability: number;
    intimacyLevel: number;
  }> {
    const where: { personaId: string; createdAt?: { gte: Date; lte: Date } } = { personaId };
    if (timeWindow) {
      where.createdAt = {
        gte: timeWindow.start,
        lte: timeWindow.end,
      };
    }

    // Get all emotional states for the persona
    const emotionalStates = await this.prisma.emotionalStateComponent.findMany({
      where: {
        emotionalState: {
          memories: {
            some: where,
          },
        },
      },
      include: {
        emotionType: true,
        emotionalState: {
          include: {
            memories: true,
          },
        },
      },
    });

    // Analyze patterns
    const emotionStats = new Map<string, { count: number; totalIntensity: number }>();
    let totalValence = 0;
    let totalArousal = 0;
    let totalDominance = 0;
    let intimateCount = 0;

    for (const state of emotionalStates) {
      const emotionName = state.emotionType.emotionName;
      const stats = emotionStats.get(emotionName) || { count: 0, totalIntensity: 0 };

      stats.count++;
      stats.totalIntensity += state.intensity;
      emotionStats.set(emotionName, stats);

      // Accumulate PAD values
      totalValence += (state.emotionType.pleasureComponent ?? 0) * state.intensity;
      totalArousal += (state.emotionType.arousalComponent ?? 0) * state.intensity;
      totalDominance += (state.emotionType.dominanceComponent ?? 0) * state.intensity;

      // Check for intimate emotions through voice modulation metadata
      if (
        state.voiceModulation &&
        typeof state.voiceModulation === 'object' &&
        'hasIntimateContent' in state.voiceModulation &&
        state.voiceModulation.hasIntimateContent
      ) {
        intimateCount++;
      }
    }

    // Calculate metrics
    const totalStates = emotionalStates.length;
    const dominantEmotions = Array.from(emotionStats.entries())
      .map(([emotion, stats]) => ({
        emotion,
        frequency: stats.count,
        avgIntensity: stats.totalIntensity / stats.count,
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    const uniqueEmotions = emotionStats.size;
    const emotionalRange = Math.min(1, uniqueEmotions / 10);

    const averageValence = totalStates > 0 ? totalValence / totalStates : 0;
    const averageArousal = totalStates > 0 ? totalArousal / totalStates : 0;
    const averageDominance = totalStates > 0 ? totalDominance / totalStates : 0;

    // Calculate stability
    const intensities = emotionalStates.map((s) => s.intensity);
    const emotionalStability = intensities.length > 0 ? (() => {
      const avgIntensity = intensities.reduce((sum: number, i: number) => sum + i, 0) / intensities.length;
      const variance = intensities.reduce((sum: number, i: number) => sum + (i - avgIntensity) ** 2, 0) / intensities.length;
      return 1 - Math.min(1, variance);
    })() : 1;

    const intimacyLevel = totalStates > 0 ? intimateCount / totalStates : 0;

    return {
      dominantEmotions,
      emotionalRange,
      averageValence,
      averageArousal,
      averageDominance,
      emotionalStability,
      intimacyLevel,
    };
  }

  /**
   * Create or update custom emotion types
   */
  async registerCustomEmotion(
    emotionName: string,
    padValues?: PADValues,
    context?: string,
  ): Promise<EmotionType> {
    // Check if already exists
    const existing = await this.prisma.emotionType.findFirst({
      where: { emotionName },
    });

    if (existing) {
      return existing;
    }

    // Use provided PAD values or estimate from context
    const pad = padValues || (await this.estimatePADFromContext(emotionName, context || ''));

    // Create new emotion type
    const newEmotion = await this.prisma.emotionType.create({
      data: {
        primaryEmotion: 'custom',
        emotionName,
        intensityLevel: 2,
        pleasureComponent: pad.pleasure,
        arousalComponent: pad.arousal,
        dominanceComponent: pad.dominance,
      },
    });

    // Update cache
    this.emotionCache.set(emotionName.toLowerCase(), newEmotion);

    return newEmotion;
  }

  /**
   * Estimate PAD values using BAML
   */
  private async estimatePADFromContext(emotionName: string, context: string): Promise<PADValues> {
    try {
      return await b.EstimatePADValues(emotionName, context);
    } catch (error) {
      console.error('Error estimating PAD values:', error);
      // Default neutral values
      return { pleasure: 0, arousal: 0.5, dominance: 0 };
    }
  }

  /**
   * Fallback emotion detection without LLM
   */
  async fallbackEmotionDetection(text: string): Promise<EmotionAnalysis> {
    // Simple keyword-based detection as fallback
    const detectedEmotions: DetectedEmotion[] = [];

    // Check for basic emotions
    const emotionKeywords = {
      joy: /\b(happy|joy|glad|pleased|delighted|excited)\b/gi,
      sadness: /\b(sad|unhappy|depressed|down|crying)\b/gi,
      anger: /\b(angry|mad|furious|annoyed|irritated)\b/gi,
      fear: /\b(afraid|scared|frightened|worried|anxious)\b/gi,
      love: /\b(love|adore|cherish|devoted)\b/gi,
      arousal: /\b(aroused|desire|want|need|yearning)\b/gi,
    };

    for (const [emotion, pattern] of Object.entries(emotionKeywords)) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        detectedEmotions.push({
          emotionName: emotion,
          intensity: Math.min(1, matches.length * 0.3),
          confidence: 0.5,
          triggers: matches,
          isCustom: !this.emotionCache.has(emotion),
          context: null,
        });
      }
    }

    // Sort by intensity
    detectedEmotions.sort((a, b) => b.intensity - a.intensity);

    return {
      primaryEmotions: detectedEmotions.slice(0, 3),
      secondaryEmotions: detectedEmotions.slice(3),
      padValues: { pleasure: 0, arousal: 0.5, dominance: 0 },
      emotionalComplexity: Math.min(1, detectedEmotions.length / 5),
      compoundEmotions: [],
      customEmotions: [],
      transitions: [],
      metadata: {
        hasIntimateContent: /\b(intimate|romantic|sensual|aroused)\b/i.test(text),
        hasPhysicalResponse: /\b(trembling|shaking|breathless|flushed)\b/i.test(text),
        emotionalIntensity: detectedEmotions.length > 3 ? 'high' : 'medium',
      },
    };
  }

  /**
   * Batch analyze emotions for multiple texts
   */
  async batchAnalyzeEmotions(texts: string[]): Promise<EmotionAnalysis[]> {
    // Process in parallel for efficiency
    const promises = texts.map((text) => this.detectEmotions(text));
    return Promise.all(promises);
  }
}
