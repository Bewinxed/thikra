import type { PersonalityParameter } from '@prisma/client';
import { PERSONALITY_THRESHOLDS } from '../utils/research-constants';

/**
 * PAD-Relationship Bridge Service
 *
 * Connects existing PAD (Pleasure-Arousal-Dominance) emotional system
 * to relationship evolution. Based on 2024 research showing PAD model
 * is more scientifically valid than complex mathematical formulas.
 */

export interface PADValues {
  pleasure: number; // -1 to 1
  arousal: number; // 0 to 1
  dominance: number; // -1 to 1
}

export interface RelationshipDeltas {
  trustDelta: number; // -1 to 1
  intimacyDelta: number; // -1 to 1
  attractionDelta: number; // -1 to 1
}

interface BigFiveTraits {
  neuroticism: number;
  extraversion: number;
  openness: number;
  agreeableness: number;
  conscientiousness: number;
}

export class PADRelationshipBridge {
  /**
   * Map PAD emotional values to relationship changes
   * Based on emotional psychology research and parasocial relationship studies
   */
  mapPADToRelationshipChange(pad: PADValues): RelationshipDeltas {
    let trustDelta = 0;
    let intimacyDelta = 0;
    let attractionDelta = 0;

    // Pleasure dimension affects all relationship aspects
    if (pad.pleasure > 0.3) {
      // Positive emotions generally improve relationships
      trustDelta += pad.pleasure * 0.1; // Pleasure builds trust slowly
      attractionDelta += pad.pleasure * 0.15; // But attraction faster

      // Low arousal + high pleasure = comfort/safety (intimacy building)
      if (pad.arousal < 0.4) {
        intimacyDelta += pad.pleasure * 0.08;
      }
    } else if (pad.pleasure < -0.3) {
      // Negative emotions hurt relationships (Gottman research: negatives have stronger impact)
      trustDelta += pad.pleasure * 0.2; // Trust drops faster than it builds
      attractionDelta += pad.pleasure * 0.25; // Attraction very sensitive to negative emotions

      // High arousal + negative pleasure = stress/fear (intimacy killer)
      if (pad.arousal > 0.6) {
        intimacyDelta += pad.pleasure * 0.3; // Strong negative impact
      }
    }

    // Arousal dimension modulates relationship changes
    if (pad.arousal > 0.7) {
      // High arousal can be positive (excitement) or negative (stress)
      if (pad.pleasure > 0) {
        attractionDelta *= 1.5; // Excitement amplifies positive attraction
      } else {
        trustDelta *= 1.3; // Stress amplifies trust damage
      }
    }

    // Dominance affects power dynamics and comfort
    if (pad.dominance > 0.5) {
      // High dominance can reduce intimacy in egalitarian relationships
      intimacyDelta *= 0.8;
    } else if (pad.dominance < -0.5) {
      // Very low dominance might signal safety/trust
      if (pad.pleasure > 0) {
        trustDelta *= 1.2;
      }
    }

    // Ensure deltas stay within reasonable bounds
    return {
      trustDelta: Math.max(-0.3, Math.min(0.3, trustDelta)),
      intimacyDelta: Math.max(-0.3, Math.min(0.3, intimacyDelta)),
      attractionDelta: Math.max(-0.5, Math.min(0.5, attractionDelta)),
    };
  }

  /**
   * Apply personality modulation using existing PersDyn parameters
   * Research shows personality traits affect relationship development patterns
   */
  applyPersonalityModulation(
    deltas: RelationshipDeltas,
    personalityParams: PersonalityParameter[],
  ): RelationshipDeltas {
    const traits = this.extractTraitValues(personalityParams);

    // Neuroticism affects trust sensitivity (research-backed)
    const neuroticism = traits.neuroticism; // Always defined, defaults to 0.5
    if (neuroticism > 0.6) {
      deltas.trustDelta *= 0.7; // Slower trust building
      if (deltas.trustDelta < 0) {
        deltas.trustDelta *= 1.5; // But faster trust loss
      }
    }

    // Extraversion affects attraction and social connection
    const extraversion = traits.extraversion;
    if (extraversion > 0.6) {
      deltas.attractionDelta *= 1.3; // Faster attraction development
      deltas.intimacyDelta *= 1.1; // Slightly faster intimacy
    } else if (extraversion < 0.4) {
      deltas.attractionDelta *= 0.8; // Slower attraction for introverts
      deltas.intimacyDelta *= 1.2; // But potentially deeper when it happens
    }

    // Openness affects intimacy development
    const openness = traits.openness;
    if (openness > 0.6) {
      deltas.intimacyDelta *= 1.4; // Very open to deep connections
    } else if (openness < 0.4) {
      deltas.intimacyDelta *= 0.6; // More cautious about intimacy
    }

    // Agreeableness affects trust patterns
    const agreeableness = traits.agreeableness;
    if (agreeableness > 0.6) {
      if (deltas.trustDelta > 0) {
        deltas.trustDelta *= 1.2; // More willing to trust
      }
    } else if (agreeableness < 0.4) {
      deltas.trustDelta *= 0.8; // More skeptical in general
    }

    // Conscientiousness affects relationship stability
    const conscientiousness = traits.conscientiousness;
    if (conscientiousness > 0.6) {
      // Dampens extreme changes (more stable relationships)
      deltas.trustDelta *= 0.9;
      deltas.intimacyDelta *= 0.9;
      deltas.attractionDelta *= 0.9;
    }

    return deltas;
  }

  /**
   * Extract trait values from PersDyn personality parameters
   * Uses baseline values from the three-parameter model
   * Default to population mean (0.5) when trait data is not available
   * Research: Costa & McCrae (1992) - Big Five traits are normally distributed around mean
   */
  private extractTraitValues(params: PersonalityParameter[]): BigFiveTraits {
    const traits: BigFiveTraits = {
      neuroticism: PERSONALITY_THRESHOLDS.POPULATION_MEAN,      // Population mean for Big Five traits
      extraversion: PERSONALITY_THRESHOLDS.POPULATION_MEAN,     // 0.5 = neutral/average on 0-1 scale
      openness: PERSONALITY_THRESHOLDS.POPULATION_MEAN,         // Not arbitrary - research validated
      agreeableness: PERSONALITY_THRESHOLDS.POPULATION_MEAN,    // Costa & McCrae (1992) NEO-PI-R norms
      conscientiousness: PERSONALITY_THRESHOLDS.POPULATION_MEAN,// Standard personality psychology practice
    };

    for (const param of params) {
      const traitName = param.traitDimension.toLowerCase();

      // Map various trait names to Big Five
      if (traitName.includes('neurot') || traitName.includes('emotional_stability')) {
        traits.neuroticism = traitName.includes('stability') ? 1 - param.baseline : param.baseline;
      } else if (traitName.includes('extraver') || traitName.includes('social')) {
        traits.extraversion = param.baseline;
      } else if (traitName.includes('open') || traitName.includes('curious')) {
        traits.openness = param.baseline;
      } else if (traitName.includes('agree') || traitName.includes('kind')) {
        traits.agreeableness = param.baseline;
      } else if (traitName.includes('conscien') || traitName.includes('organized')) {
        traits.conscientiousness = param.baseline;
      }
    }

    return traits;
  }

  /**
   * Analyze if a PAD state indicates a significant emotional event
   * Helps determine when to trigger relationship updates
   */
  isSignificantEmotionalState(pad: PADValues): boolean {
    // High intensity emotions (any combination of high absolute values)
    const intensity = Math.sqrt(
      pad.pleasure * pad.pleasure + pad.arousal * pad.arousal + pad.dominance * pad.dominance,
    );

    return intensity > 0.7; // Threshold for "significant" emotional states
  }

  /**
   * Determine emotional context description for relationship evolution records
   */
  describeEmotionalContext(pad: PADValues): string {
    if (pad.pleasure > 0.5 && pad.arousal > 0.5) return 'excited_positive';
    if (pad.pleasure > 0.5 && pad.arousal < 0.3) return 'calm_positive';
    if (pad.pleasure < -0.5 && pad.arousal > 0.5) return 'stressed_negative';
    if (pad.pleasure < -0.5 && pad.arousal < 0.3) return 'sad_negative';
    if (Math.abs(pad.pleasure) < 0.3) return 'neutral';

    return 'mixed_emotions';
  }

  /**
   * Get the primary emotion type from PAD coordinates
   * Maps to existing emotion system for consistency
   */
  getPrimaryEmotionFromPAD(pad: PADValues): string {
    // Simple mapping based on PAD research
    if (pad.pleasure > 0.3 && pad.arousal > 0.5) return 'joy';
    if (pad.pleasure > 0.3 && pad.arousal < 0.3) return 'contentment';
    if (pad.pleasure < -0.3 && pad.arousal > 0.5) return 'anger';
    if (pad.pleasure < -0.3 && pad.arousal < 0.3) return 'sadness';
    if (pad.arousal > 0.7 && Math.abs(pad.pleasure) < 0.3) return 'surprise';
    if (pad.pleasure < -0.1 && pad.dominance < -0.3) return 'fear';

    return 'neutral';
  }
}
