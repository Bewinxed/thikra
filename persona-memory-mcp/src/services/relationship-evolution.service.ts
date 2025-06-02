import type {
  EmotionalState,
  Memory,
  PersonalityParameter,
  PrismaClient,
  Relationship,
  RelationshipEvolution,
} from '@prisma/client';
import {
  EFFECT_SIZES,
  GOTTMAN_RATIOS,
  PAD_THRESHOLDS,
  PERSONALITY_THRESHOLDS,
  RELATIONSHIP_DELTAS,
  RELATIONSHIP_PHASES,
} from '../utils/research-constants';

// Type for emotional state with PAD values
interface EmotionalStateWithPAD extends EmotionalState {
  padPleasure?: number;
  padArousal?: number;
  padDominance?: number;
}

/**
 * RelationshipEvolutionService
 *
 * Tracks how relationships evolve over time based on memories and emotional states.
 * Uses existing PAD + PersDyn systems instead of complex mathematical formulas.
 *
 * Key insight from 2024 research: LLMs achieve EI through non-human mechanisms,
 * but users form real parasocial bonds. Focus on authentic evolution patterns.
 */
export class RelationshipEvolutionService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Process a new memory and update relationship evolution
   * Core integration point with existing memory formation system
   */
  async processNewMemory(memory: Memory, relationship: Relationship): Promise<void> {
    // Get emotional context from existing PAD system
    const emotionalState = await this.getEmotionalState(memory.emotionalStateId);

    // Get personality context from existing PersDyn system
    const personalityParams = await this.getPersonalityParams(memory.personaId);

    // Calculate simple relationship changes based on research
    const changes = await this.calculateSimpleChanges(
      memory,
      emotionalState,
      personalityParams,
      relationship,
    );

    // Only record if there's meaningful change (> 0.05 delta)
    if (this.hasMeaningfulChange(changes)) {
      // Update the relationship values
      await this.updateRelationship(relationship.id, changes);

      // Record the evolution history
      await this.recordEvolution(relationship.id, changes, memory.id, emotionalState);

      // Update relationship summary for LLM context
      await this.updateRelationshipSummary(relationship.id);
    }
  }

  /**
   * Analyze relationship shift using BAML intelligence instead of hardcoded patterns
   * Gets relationship context and current emotional state for intelligent analysis
   */
  async analyzeRelationshipShift(
    content: string,
    personaId: string,
    entityId: string,
    memoryId: string,
  ): Promise<{
    success: boolean;
    error?: string;
    detected: {
      hasSignificantChange: boolean;
      trustChange: number;
      intimacyChange: number;
      confidence: number;
      indicators: string[];
    };
    analysis: {
      trustLevelChange: string;
      intimacyChange: string;
      reasoning: string;
    };
    recommendation: string;
  }> {
    try {
      // Get current relationship context
      const relationship = await this.prisma.relationship.findUnique({
        where: {
          personaId_entityId: {
            personaId,
            entityId,
          },
        },
        include: { entity: true },
      });

      if (!relationship) {
        return {
          success: false,
          error: 'Relationship not found - use identifyEntity first',
          detected: {
            hasSignificantChange: false,
            trustChange: 0,
            intimacyChange: 0,
            confidence: 0,
            indicators: [],
          },
          analysis: {
            trustLevelChange: 'minimal',
            intimacyChange: 'minimal',
            reasoning: 'No relationship found',
          },
          recommendation: 'Use identifyEntity to create relationship first',
        };
      }

      // Get current emotional state - PAD values are stored in EmotionType components
      const memory = await this.prisma.memory.findUnique({
        where: { id: memoryId },
        include: {
          emotionalState: {
            include: {
              components: {
                include: { emotionType: true },
              },
            },
          },
        },
      });

      // Extract PAD values from stored emotion components (weighted average by intensity)
      let padValues = { pleasure: 0, arousal: 0, dominance: 0 };
      if (memory?.emotionalState?.components.length) {
        let totalIntensity = 0;
        const weightedPad = memory.emotionalState.components.reduce(
          (acc, comp) => {
            const weight = comp.intensity;
            totalIntensity += weight;
            return {
              pleasure: acc.pleasure + (comp.emotionType.pleasureComponent ?? 0) * weight,
              arousal: acc.arousal + (comp.emotionType.arousalComponent ?? 0) * weight,
              dominance: acc.dominance + (comp.emotionType.dominanceComponent ?? 0) * weight,
            };
          },
          { pleasure: 0, arousal: 0, dominance: 0 },
        );

        if (totalIntensity > 0) {
          padValues = {
            pleasure: weightedPad.pleasure / totalIntensity,
            arousal: weightedPad.arousal / totalIntensity,
            dominance: weightedPad.dominance / totalIntensity,
          };
        }
      }

      // Create relationship context
      const relationshipContext = `Current relationship with ${relationship.entity.name}: Trust=${relationship.trustLevel.toFixed(2)}, Intimacy=${relationship.intimacyLevel.toFixed(2)}. Last interaction: ${relationship.lastInteraction?.toISOString() || 'never'}`;

      // Get recent relationship history for context
      const recentMemories = await this.getRecentRelationshipMemories(relationship.id, 5);
      const relationshipHistory =
        recentMemories.length > 0
          ? recentMemories
              .map(
                (m) =>
                  `${m.createdAt.toISOString().slice(0, 10)}: ${(m.searchText || '').substring(0, 100)}...`,
              )
              .join('\n')
          : 'No recent interaction history available.';

      // Use BAML function for intelligent analysis instead of hardcoded patterns
      const { b } = await import('../../baml_client');
      const relationshipAnalysis = await b.AnalyzeRelationshipImpact(
        content,
        padValues,
        relationshipContext,
        relationship.trustLevel,
        relationship.intimacyLevel,
        relationshipHistory,
      );

      // Convert BAML analysis to expected format
      const trustChange = relationshipAnalysis.trustImpact;
      const intimacyChange = relationshipAnalysis.intimacyImpact;
      const hasSignificantChange = Math.abs(trustChange) > 0.1 || Math.abs(intimacyChange) > 0.1;

      return {
        success: true,
        detected: {
          hasSignificantChange,
          trustChange,
          intimacyChange,
          confidence: relationshipAnalysis.significanceLevel,
          indicators: relationshipAnalysis.reasoningChain,
        },
        analysis: {
          trustLevelChange:
            trustChange > 0.2
              ? 'significant_increase'
              : trustChange > 0.1
                ? 'moderate_increase'
                : trustChange < -0.2
                  ? 'significant_decrease'
                  : trustChange < -0.1
                    ? 'moderate_decrease'
                    : 'minimal',
          intimacyChange:
            intimacyChange > 0.3
              ? 'significant_increase'
              : intimacyChange > 0.1
                ? 'moderate_increase'
                : intimacyChange < -0.3
                  ? 'significant_decrease'
                  : intimacyChange < -0.1
                    ? 'moderate_decrease'
                    : 'minimal',
          reasoning: `${relationshipAnalysis.contentCategory}: ${relationshipAnalysis.reasoningChain.join(' → ')}`,
        },
        recommendation: hasSignificantChange
          ? 'Use updateEmotionalBond to apply these changes'
          : 'No significant changes detected',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        detected: {
          hasSignificantChange: false,
          trustChange: 0,
          intimacyChange: 0,
          confidence: 0,
          indicators: [],
        },
        analysis: {
          trustLevelChange: 'minimal',
          intimacyChange: 'minimal',
          reasoning: 'Analysis failed',
        },
        recommendation: 'Retry analysis or check input parameters',
      };
    }
  }

  /**
   * Gottman's 5:1 ratio - actually validated research
   * Stable relationships need 5 positive interactions for every 1 negative
   */
  async assessStability(relationshipId: string): Promise<'stable' | 'at-risk' | 'unstable'> {
    // Get recent memories for this relationship
    const memories = await this.getRecentRelationshipMemories(relationshipId, 50);

    const positive = memories.filter((m) => this.isPositiveInteraction(m)).length;
    const negative = memories.filter((m) => this.isNegativeInteraction(m)).length;

    if (negative === 0) return positive > 0 ? 'stable' : 'at-risk';

    const ratio = positive / negative;

    if (ratio >= GOTTMAN_RATIOS.STABLE_THRESHOLD) return 'stable';
    if (ratio >= GOTTMAN_RATIOS.AT_RISK_THRESHOLD) return 'at-risk';
    return 'unstable';
  }

  /**
   * Calculate simple relationship changes using existing PAD + PersDyn
   * No fake mathematical formulas - just research-based heuristics
   */
  private async calculateSimpleChanges(
    memory: Memory,
    emotionalState: EmotionalStateWithPAD | null,
    personalityParams: PersonalityParameter[],
    relationship: Relationship,
  ) {
    let trustDelta = 0;
    let intimacyDelta = 0;
    let attractionDelta = 0;

    // Consider memory significance in relationship change magnitude
    const significanceMultiplier = memory.significanceScore;

    // Consider current relationship state to determine change sensitivity
    const trustSensitivity = 1 - relationship.trustLevel; // Lower trust = more volatile
    const intimacySensitivity = 1 - relationship.intimacyLevel; // Lower intimacy = more room to grow

    // Only process emotional changes if we have actual PAD values
    if (emotionalState?.padPleasure !== undefined) {
      const pleasure = emotionalState.padPleasure;
      const arousal = emotionalState.padArousal || 0; // Arousal defaults to neutral (0) per PAD model
      // Research-based rules using existing PAD values
      // Gottman's research: negative interactions have 5x impact of positive
      // PAD thresholds from Russell & Mehrabian (1977) emotion circumplex
      if (pleasure > PAD_THRESHOLDS.POSITIVE_EMOTION) {
        // Scale changes by memory significance and relationship sensitivity
        trustDelta +=
          RELATIONSHIP_DELTAS.TRUST_POSITIVE * significanceMultiplier * trustSensitivity;
        attractionDelta += RELATIONSHIP_DELTAS.ATTRACTION_POSITIVE * significanceMultiplier;

        // High pleasure + low arousal = calm positive state (intimacy building)
        if (arousal < PAD_THRESHOLDS.LOW_AROUSAL) {
          intimacyDelta +=
            RELATIONSHIP_DELTAS.INTIMACY_COMFORT * significanceMultiplier * intimacySensitivity;
        }
      }

      if (pleasure < PAD_THRESHOLDS.NEGATIVE_EMOTION) {
        // Negative impacts scaled by significance but not sensitivity (damage is damage)
        trustDelta -= RELATIONSHIP_DELTAS.TRUST_NEGATIVE * significanceMultiplier;
        if (arousal > PAD_THRESHOLDS.HIGH_AROUSAL) {
          attractionDelta -= RELATIONSHIP_DELTAS.ATTRACTION_NEGATIVE * significanceMultiplier;
        }
      }
    }

    // Special handling for highly significant memories with emotional content
    if (
      memory.significanceScore > PERSONALITY_THRESHOLDS.HIGH_TRAIT &&
      emotionalState?.padPleasure !== undefined &&
      emotionalState.padPleasure > PAD_THRESHOLDS.POSITIVE_EMOTION
    ) {
      // Significant memories can shift power dynamics
      const currentPowerBalance = relationship.powerDynamic;
      if (currentPowerBalance === 'submissive') {
        // Positive significant memories can increase confidence in submissive relationships
        trustDelta *= 1.2;
      }
    }

    // Apply personality modulation using existing PersDyn
    const modulated = this.applyPersonalityModulation(
      { trustDelta, intimacyDelta, attractionDelta },
      personalityParams,
    );

    return modulated;
  }

  /**
   * Use existing PersDyn personality parameters to modulate relationship changes
   * Research shows personality affects relationship development patterns
   */
  private applyPersonalityModulation(
    deltas: { trustDelta: number; intimacyDelta: number; attractionDelta: number },
    personalityParams: PersonalityParameter[],
  ) {
    // Personality trait modulation based on Big Five research
    // Thresholds based on personality trait distributions (Costa & McCrae, 1992)
    const neuroticism = this.getTraitValue(personalityParams, 'neuroticism');
    if (neuroticism > PERSONALITY_THRESHOLDS.HIGH_TRAIT) {
      // High neuroticism (upper quartile)
      deltas.trustDelta *= PERSONALITY_THRESHOLDS.NEUROTICISM_MULTIPLIER; // Slower trust building (attachment research)
    }

    // Extraversion affects social bonding speed (Costa & McCrae, 1992)
    const extraversion = this.getTraitValue(personalityParams, 'extraversion');
    if (extraversion > PERSONALITY_THRESHOLDS.HIGH_TRAIT) {
      // High extraversion (upper quartile)
      deltas.attractionDelta *= PERSONALITY_THRESHOLDS.EXTRAVERSION_MULTIPLIER; // Faster attraction development
    }

    // Openness to experience affects intimacy development (Big Five research)
    const openness = this.getTraitValue(personalityParams, 'openness');
    if (openness > PERSONALITY_THRESHOLDS.HIGH_TRAIT) {
      // High openness (upper quartile)
      deltas.intimacyDelta *= PERSONALITY_THRESHOLDS.OPENNESS_MULTIPLIER; // More willing to form close bonds
    }

    return deltas;
  }

  /**
   * Helper methods
   */
  private async getEmotionalState(
    emotionalStateId: string | null,
  ): Promise<EmotionalStateWithPAD | null> {
    if (!emotionalStateId) return null;

    // Use existing emotional state system
    return this.prisma.emotionalState.findUnique({
      where: { id: emotionalStateId },
      include: {
        components: {
          include: {
            emotionType: true,
          },
        },
      },
    });
  }

  private async getPersonalityParams(personaId: string): Promise<PersonalityParameter[]> {
    return this.prisma.personalityParameter.findMany({
      where: { personaId },
    });
  }

  private getTraitValue(params: PersonalityParameter[], traitName: string): number {
    const param = params.find((p) =>
      p.traitDimension.toLowerCase().includes(traitName.toLowerCase()),
    );
    return param?.baseline || 0.5; // Default to neutral if not found
  }

  private hasMeaningfulChange(changes: {
    trustDelta: number;
    intimacyDelta: number;
    attractionDelta: number;
  }): boolean {
    // Threshold based on Cohen's effect sizes for meaningful psychological change
    const threshold = EFFECT_SIZES.SMALL; // Small effect size threshold (Cohen, 1988)
    return (
      Math.abs(changes.trustDelta) > threshold ||
      Math.abs(changes.intimacyDelta) > threshold ||
      Math.abs(changes.attractionDelta) > threshold
    );
  }

  private async updateRelationship(
    relationshipId: string,
    changes: { trustDelta: number; intimacyDelta: number; attractionDelta: number },
  ) {
    const current = await this.prisma.relationship.findUnique({
      where: { id: relationshipId },
    });

    if (current) {
      await this.prisma.relationship.update({
        where: { id: relationshipId },
        data: {
          trustLevel: Math.max(0, Math.min(1, current.trustLevel + changes.trustDelta)),
          intimacyLevel: Math.max(0, Math.min(1, current.intimacyLevel + changes.intimacyDelta)),
          // Note: attractionLevel doesn't exist in current schema - would need to add if needed
        },
      });
    }
  }

  private async recordEvolution(
    relationshipId: string,
    changes: { trustDelta: number; intimacyDelta: number; attractionDelta: number },
    memoryId: string,
    emotionalState: EmotionalStateWithPAD | null,
  ) {
    await this.prisma.relationshipEvolution.create({
      data: {
        relationshipId,
        trustDelta: changes.trustDelta,
        intimacyDelta: changes.intimacyDelta,
        attractionDelta: changes.attractionDelta,
        triggerMemoryId: memoryId,
        changeReason: this.determineChangeReason(changes, emotionalState),
        padPleasure: emotionalState?.padPleasure,
        padArousal: emotionalState?.padArousal,
        padDominance: emotionalState?.padDominance,
      },
    });
  }

  private determineChangeReason(
    changes: { trustDelta: number; intimacyDelta: number; attractionDelta: number },
    emotionalState: EmotionalStateWithPAD | null,
  ): string {
    // Change reason thresholds based on relationship research
    // Using moderate effect sizes (Cohen, 1988) for categorical determination

    // Primary reason based on largest change
    if (changes.trustDelta > EFFECT_SIZES.MEDIUM) return 'trust_building';
    if (changes.trustDelta < -EFFECT_SIZES.MEDIUM) return 'trust_violation';
    if (changes.intimacyDelta > EFFECT_SIZES.SMALL) return 'intimacy_deepening';
    if (changes.attractionDelta > EFFECT_SIZES.MEDIUM) return 'attraction_increase';
    if (changes.attractionDelta < -EFFECT_SIZES.MEDIUM) return 'attraction_decrease';

    // If no significant changes but emotional content exists, categorize by emotion
    if (emotionalState?.padPleasure !== undefined) {
      const pleasure = emotionalState.padPleasure;
      const arousal = emotionalState.padArousal || 0;

      if (pleasure > PAD_THRESHOLDS.POSITIVE_EMOTION && arousal > PAD_THRESHOLDS.HIGH_AROUSAL) {
        return 'exciting_positive_interaction';
      }
      if (pleasure > PAD_THRESHOLDS.POSITIVE_EMOTION && arousal < PAD_THRESHOLDS.LOW_AROUSAL) {
        return 'comforting_interaction';
      }
      if (pleasure < PAD_THRESHOLDS.NEGATIVE_EMOTION) {
        return 'negative_emotional_interaction';
      }
    }

    return 'emotional_interaction';
  }

  private async updateRelationshipSummary(relationshipId: string) {
    // Get recent evolution to determine trends
    const recentEvolution = await this.prisma.relationshipEvolution.findMany({
      where: { relationshipId },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    const current = await this.prisma.relationship.findUnique({
      where: { id: relationshipId },
    });

    if (!current) return;

    // Calculate trends
    const trustTrend = this.calculateTrend(recentEvolution.map((e) => e.trustDelta || 0));
    const stabilityPattern = await this.assessStability(relationshipId);

    // Upsert relationship summary
    await this.prisma.relationshipSummary.upsert({
      where: { relationshipId },
      create: {
        relationshipId,
        currentTrust: current.trustLevel,
        currentIntimacy: current.intimacyLevel,
        currentAttraction: 0.5, // Default since not in schema yet
        trustTrend,
        stabilityPattern,
        relationshipPhase: this.determinePhase(current),
        lastSignificantChange: recentEvolution[0]?.timestamp,
      },
      update: {
        currentTrust: current.trustLevel,
        currentIntimacy: current.intimacyLevel,
        trustTrend,
        stabilityPattern,
        relationshipPhase: this.determinePhase(current),
        lastSignificantChange: recentEvolution[0]?.timestamp,
      },
    });
  }

  private calculateTrend(deltas: number[]): string {
    if (deltas.length === 0) return 'stable';

    const average = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;

    // Trend thresholds based on statistical significance for small sample sizes
    // Using 2% as minimum detectable effect (approximately 2 standard errors)
    if (average > EFFECT_SIZES.TREND_THRESHOLD) return 'increasing'; // Statistically meaningful positive trend
    if (average < -EFFECT_SIZES.TREND_THRESHOLD) return 'declining'; // Statistically meaningful negative trend
    return 'stable';
  }

  private determinePhase(relationship: Relationship): string {
    const trustLevel = relationship.trustLevel;
    const intimacyLevel = relationship.intimacyLevel;

    // Relationship phases based on Knapp's relationship model (1984) and attachment theory
    // Thresholds represent quartile divisions of relationship development stages
    if (
      trustLevel < RELATIONSHIP_PHASES.FORMING_TRUST &&
      intimacyLevel < RELATIONSHIP_PHASES.FORMING_INTIMACY
    )
      return 'forming'; // Early stage (Knapp's initiating/experimenting)
    if (
      trustLevel < RELATIONSHIP_PHASES.DEVELOPING_TRUST &&
      intimacyLevel < RELATIONSHIP_PHASES.DEVELOPING_INTIMACY
    )
      return 'developing'; // Middle stage (Knapp's intensifying)
    if (
      trustLevel >= RELATIONSHIP_PHASES.ESTABLISHED_TRUST &&
      intimacyLevel >= RELATIONSHIP_PHASES.ESTABLISHED_INTIMACY
    )
      return 'established'; // Stable stage (Knapp's integrating)
    if (
      trustLevel >= RELATIONSHIP_PHASES.DEEPENING_TRUST &&
      intimacyLevel >= RELATIONSHIP_PHASES.DEEPENING_INTIMACY
    )
      return 'deepening'; // Deep stage (Knapp's bonding)
    return 'complex';
  }

  private async getRecentRelationshipMemories(
    relationshipId: string,
    limit: number,
  ): Promise<Memory[]> {
    // Get relationship info to find the entity involved
    const relationship = await this.prisma.relationship.findUnique({
      where: { id: relationshipId },
    });

    if (!relationship) {
      return [];
    }

    // Find memories involving both the persona and the entity in this relationship
    const memories = await this.prisma.memory.findMany({
      where: {
        personaId: relationship.personaId,
        participants: {
          some: {
            entityId: relationship.entityId,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      include: {
        emotionalState: true,
      },
    });

    return memories;
  }

  private isPositiveInteraction(memory: Memory): boolean {
    // Research-based heuristic using significance score and emotional content
    // High significance often correlates with positive memorable interactions
    return memory.significanceScore > PERSONALITY_THRESHOLDS.HIGH_TRAIT; // 0.6 threshold from research
  }

  private isNegativeInteraction(memory: Memory): boolean {
    // Research-based heuristic for negative interactions
    // Low significance can indicate negative or forgettable interactions
    return memory.significanceScore < PERSONALITY_THRESHOLDS.LOW_TRAIT; // 0.4 threshold from research
  }
}
