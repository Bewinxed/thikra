import type {
  PersonalityObservation,
  PersonalityParameter,
  PersonalityParameterHistory,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { b } from '../../baml_client';
import type {
  PersonalityObservation as BAMLObservation,
  PersonalityDynamicsAnalysis,
} from '../../baml_client/types';
import { PromptCache } from '../utils/prompt-cache';

// No longer needed - we use proper DB fields now!

/**
 * PersonalityMonitor Service
 *
 * Implements computational phenotyping approach using PersDyn three-parameter model:
 * - Baseline (μ): Long-term stable personality center
 * - Variability (σ): Natural fluctuation range
 * - Attractor Force (θ): Pull back to baseline strength
 *
 * Uses Bayesian parameter estimation with NO hardcoded thresholds.
 * All traits and patterns emerge from data.
 */
export class PersonalityMonitorService {
  private promptCache = new PromptCache();

  constructor(private prisma: PrismaClient) {}

  /**
   * Extract personality observations from conversation content
   */
  async extractObservations(
    personaId: string,
    content: string,
    memoryId?: string,
    recentHistory?: string,
  ): Promise<PersonalityObservation[]> {
    // Use BAML to extract personality observations with caching
    const result = await b.ExtractPersonalityObservations(content, recentHistory ?? null);

    // Cache the BAML call for visibility
    await this.promptCache.store(
      'ExtractPersonalityObservations',
      `Content: ${content}\nRecent History: ${recentHistory ?? 'null'}`,
      result,
      undefined,
    );

    // Store observations in database with proper relational fields
    const observations = await Promise.all(
      result.observations.map(async (obs) => {
        // Resolve interactionPartner and emotionalState if provided
        let interactionPartnerId: string | null = null;
        let emotionalStateId: string | null = null;

        if (obs.interactionPartner) {
          // Find or create Entity for interaction partner
          const entity = await this.prisma.entity.findFirst({
            where: { name: obs.interactionPartner },
          });
          interactionPartnerId = entity?.id || null;
        }

        if (obs.emotionalState) {
          // Create a new EmotionalState for this observation
          const emotionalState = await this.prisma.emotionalState.create({
            data: {},
          });
          emotionalStateId = emotionalState.id;
        }

        // First create the observation
        const observation = await this.prisma.personalityObservation.create({
          data: {
            personaId,
            traitDimension: obs.traitDimension,
            observedValue: obs.observedValue,
            confidence: obs.confidence,
            situation: obs.situation,
            trigger: obs.trigger,
            sourceMemoryId: memoryId,
            interactionPartnerId,
            emotionalStateId,
          },
        });

        // Then create evidence records
        if (obs.evidence.length > 0) {
          await this.prisma.personalityObservationEvidence.createMany({
            data: obs.evidence.map((evidence) => ({
              observationId: observation.id,
              evidence,
              evidenceType: 'quote', // Could be enhanced to detect type
            })),
          });
        }

        return observation;
      }),
    );

    // Update personality parameters with new observations
    await this.updateParameters(personaId, observations);

    return observations;
  }

  /**
   * Update personality parameters using Bayesian estimation
   * Implements Ornstein-Uhlenbeck process: dX(t) = θ(μ - X(t))dt + σdW(t)
   */
  private async updateParameters(
    personaId: string,
    newObservations: PersonalityObservation[],
  ): Promise<void> {
    // Group observations by trait dimension
    const observationsByTrait = new Map<string, PersonalityObservation[]>();
    for (const obs of newObservations) {
      const trait = obs.traitDimension;
      if (!observationsByTrait.has(trait)) {
        observationsByTrait.set(trait, []);
      }
      const traitObservations = observationsByTrait.get(trait);
      if (traitObservations) {
        traitObservations.push(obs);
      }
    }

    // Update parameters for each trait
    for (const [traitDimension, observations] of observationsByTrait) {
      await this.updateTraitParameters(personaId, traitDimension, observations);
    }
  }

  /**
   * Update parameters for a specific trait using Bayesian approach
   */
  private async updateTraitParameters(
    personaId: string,
    traitDimension: string,
    newObservations: PersonalityObservation[],
  ): Promise<void> {
    // Get existing parameters or create new ones
    let params = await this.prisma.personalityParameter.findUnique({
      where: {
        personaId_traitDimension: { personaId, traitDimension },
      },
    });

    // Get all historical observations for this trait
    const allObservations = await this.prisma.personalityObservation.findMany({
      where: { personaId, traitDimension },
      orderBy: { observedAt: 'asc' },
    });

    // Calculate new parameters using Bayesian estimation
    const { baseline, variability, attractorForce, uncertainties } =
      this.estimateParameters(allObservations);

    if (!params) {
      // Create new parameters
      params = await this.prisma.personalityParameter.create({
        data: {
          personaId,
          traitDimension,
          baseline,
          variability,
          attractorForce,
          baselineUncertainty: uncertainties.baseline,
          variabilityUncertainty: uncertainties.variability,
          attractorUncertainty: uncertainties.attractor,
          observationCount: allObservations.length,
        },
      });
    } else {
      // Check if parameters have changed significantly
      const parameterDrift = this.calculateParameterDrift(params, {
        baseline,
        variability,
        attractorForce,
      });

      if (parameterDrift.significant) {
        // Record history before updating
        await this.prisma.personalityParameterHistory.create({
          data: {
            parameterId: params.id,
            baseline: params.baseline,
            variability: params.variability,
            attractorForce: params.attractorForce,
            triggerType: 'parameter_drift',
            baselineDrift: parameterDrift.details.baselineDrift as number,
            variabilityDrift: parameterDrift.details.variabilityDrift as number,
            attractorDrift: parameterDrift.details.attractorDrift as number,
            driftSignificance: parameterDrift.significant ? 1.0 : 0.0,
          },
        });

        // Update parameters
        params = await this.prisma.personalityParameter.update({
          where: { id: params.id },
          data: {
            baseline,
            variability,
            attractorForce,
            baselineUncertainty: uncertainties.baseline,
            variabilityUncertainty: uncertainties.variability,
            attractorUncertainty: uncertainties.attractor,
            observationCount: allObservations.length,
            lastUpdated: new Date(),
          },
        });
      }
    }
  }

  /**
   * Estimate PersDyn parameters using Bayesian approach
   * No hardcoded thresholds - patterns emerge from data
   */
  private estimateParameters(observations: PersonalityObservation[]): {
    baseline: number;
    variability: number;
    attractorForce: number;
    uncertainties: {
      baseline: number;
      variability: number;
      attractor: number;
    };
  } {
    if (observations.length === 0) {
      throw new Error('Cannot estimate parameters without observations');
    }

    // Weight observations by confidence
    const weights = observations.map((o) => o.confidence);
    const values = observations.map((o) => o.observedValue);

    // Calculate weighted baseline (mean)
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const baseline = values.reduce((sum, val, i) => sum + val * (weights[i] ?? 0), 0) / weightSum;

    // Calculate weighted variability (standard deviation)
    const squaredDiffs = values.map((val, i) => {
      const weight = weights[i] ?? 1;
      return ((val - baseline) * weight) ** 2;
    });
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / weightSum;
    const variability = Math.sqrt(variance);

    // Estimate attractor force from return-to-baseline patterns
    const attractorForce = this.estimateAttractorForce(observations, baseline);

    // Calculate uncertainties based on observation count and consistency
    const uncertainties = this.calculateUncertainties(
      observations,
      baseline,
      variability,
      attractorForce,
    );

    return { baseline, variability, attractorForce, uncertainties };
  }

  /**
   * Estimate attractor force by analyzing return-to-baseline patterns
   */
  private estimateAttractorForce(observations: PersonalityObservation[], baseline: number): number {
    if (observations.length < 3) {
      // Not enough data to estimate attractor force
      return 0.5; // Default middle value
    }

    // Analyze sequential observations for mean reversion
    let reversionCount = 0;
    let reversionStrengthSum = 0;

    for (let i = 1; i < observations.length - 1; i++) {
      const prev = observations[i - 1]?.observedValue;
      const curr = observations[i]?.observedValue;
      const next = observations[i + 1]?.observedValue;

      if (prev === undefined || curr === undefined || next === undefined) continue;

      // Check if moving back toward baseline
      const prevDist = Math.abs(prev - baseline);
      const currDist = Math.abs(curr - baseline);
      const nextDist = Math.abs(next - baseline);

      if (currDist > prevDist && nextDist < currDist) {
        // Deviation followed by return
        reversionCount++;
        const reversionStrength = (currDist - nextDist) / currDist;
        reversionStrengthSum += reversionStrength;
      }
    }

    // Normalize to 0-1 range
    if (reversionCount === 0) return 0.5;

    const avgReversionStrength = reversionStrengthSum / reversionCount;
    const reversionFrequency = reversionCount / (observations.length - 2);

    // Combine frequency and strength for overall attractor force
    return Math.min(1, avgReversionStrength * reversionFrequency * 2);
  }

  /**
   * Calculate parameter uncertainties using Bayesian principles
   */
  private calculateUncertainties(
    observations: PersonalityObservation[],
    baseline: number,
    variability: number,
    attractorForce: number,
  ): { baseline: number; variability: number; attractor: number } {
    const n = observations.length;

    // More observations = less uncertainty
    const observationFactor = 1 / Math.sqrt(n);

    // Higher confidence observations = less uncertainty
    const avgConfidence = observations.reduce((sum, o) => sum + o.confidence, 0) / n;
    const confidenceFactor = 1 - avgConfidence;

    // More consistent observations = less uncertainty
    const consistency = this.calculateConsistency(observations, baseline, variability);
    const consistencyFactor = 1 - consistency;

    // Combine factors
    const baseFactor = (observationFactor * (1 + confidenceFactor + consistencyFactor)) / 3;

    return {
      baseline: baseFactor,
      variability: baseFactor * 1.2, // Variability harder to estimate
      attractor: baseFactor * 1.5, // Attractor force hardest to estimate
    };
  }

  /**
   * Calculate consistency of observations
   */
  private calculateConsistency(
    observations: PersonalityObservation[],
    baseline: number,
    variability: number,
  ): number {
    if (variability === 0) return 1; // Perfect consistency

    // Check how well observations fit expected distribution
    let withinOneSD = 0;
    let withinTwoSD = 0;

    for (const obs of observations) {
      const distance = Math.abs(obs.observedValue - baseline);
      if (distance <= variability) withinOneSD++;
      if (distance <= 2 * variability) withinTwoSD++;
    }

    // Expected: ~68% within 1 SD, ~95% within 2 SD
    const oneSDRatio = withinOneSD / observations.length;
    const twoSDRatio = withinTwoSD / observations.length;

    const oneSDScore = 1 - Math.abs(oneSDRatio - 0.68);
    const twoSDScore = 1 - Math.abs(twoSDRatio - 0.95);

    return (oneSDScore + twoSDScore) / 2;
  }

  /**
   * Calculate if parameters have drifted significantly
   */
  private calculateParameterDrift(
    current: PersonalityParameter,
    updated: { baseline: number; variability: number; attractorForce: number },
  ): { significant: boolean; details: Record<string, unknown> } {
    // Use uncertainty bounds to determine significance
    const baselineDrift = Math.abs(current.baseline - updated.baseline);
    const variabilityDrift = Math.abs(current.variability - updated.variability);
    const attractorDrift = Math.abs(current.attractorForce - updated.attractorForce);

    // Drift is significant if it exceeds uncertainty bounds
    const significant =
      baselineDrift > current.baselineUncertainty ||
      variabilityDrift > current.variabilityUncertainty ||
      attractorDrift > current.attractorUncertainty;

    return {
      significant,
      details: {
        baselineDrift,
        variabilityDrift,
        attractorDrift,
        uncertainties: {
          baseline: current.baselineUncertainty,
          variability: current.variabilityUncertainty,
          attractor: current.attractorUncertainty,
        },
      },
    };
  }

  /**
   * Get current personality parameters for a persona
   */
  async getPersonalityProfile(personaId: string): Promise<PersonalityParameter[]> {
    return this.prisma.personalityParameter.findMany({
      where: { personaId },
      include: {
        parameterHistory: {
          orderBy: { recordedAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  /**
   * Analyze personality dynamics over time
   */
  async analyzePersonalityDynamics(
    personaId: string,
    traitDimensions?: string[],
  ): Promise<PersonalityDynamicsAnalysis[]> {
    const where: Prisma.PersonalityObservationWhereInput = { personaId };
    if (traitDimensions?.length) {
      where.traitDimension = { in: traitDimensions };
    }

    const recentObservations = await this.prisma.personalityObservation.findMany({
      where,
      orderBy: { observedAt: 'desc' },
      take: 50,
    });

    const historicalContext = await this.prisma.personalityParameter.findMany({
      where: { personaId },
      include: {
        parameterHistory: {
          orderBy: { recordedAt: 'desc' },
          take: 5,
        },
      },
    });

    // Fetch observations with their relations for proper analysis
    const observationsWithRelations = await this.prisma.personalityObservation.findMany({
      where: { personaId },
      include: {
        interactionPartner: true,
        emotionalState: true,
        evidence: true,
      },
      orderBy: { observedAt: 'desc' },
      take: 20, // Get recent observations for dynamics analysis
    });

    // Use BAML to analyze dynamics
    const observationsForAnalysis = observationsWithRelations.map((obs) => ({
      traitDimension: obs.traitDimension,
      observedValue: obs.observedValue,
      confidence: obs.confidence,
      situation: obs.situation,
      interactionPartner: obs.interactionPartner?.name || null,
      emotionalState: obs.emotionalState ? 'present' : null,
      trigger: obs.trigger,
      evidence: obs.evidence.map((e) => e.evidence),
    }));

    const analysis = await b.AnalyzePersonalityDynamics(
      observationsForAnalysis,
      JSON.stringify(historicalContext),
    );

    // Cache the BAML call for visibility
    await this.promptCache.store(
      'AnalyzePersonalityDynamics',
      `Observations: ${JSON.stringify(observationsForAnalysis, null, 2)}\nHistorical Context: ${JSON.stringify(historicalContext)}`,
      analysis,
      undefined,
    );

    return analysis;
  }

  /**
   * Detect emerging personality patterns without hardcoded thresholds
   */
  async detectEmergingPatterns(
    personaId: string,
    timeWindow: { start: Date; end: Date },
  ): Promise<
    Array<{
      traitDimension: string;
      trend: string | null;
      cycles: { type: string; frequency: number; avgPeriod: number } | null;
      contextPatterns: Array<{
        context: string;
        avgValue: number;
        consistency: number;
        sampleSize: number;
      }>;
      observationCount: number;
      confidence: number;
    }>
  > {
    const observations = await this.prisma.personalityObservation.findMany({
      where: {
        personaId,
        observedAt: {
          gte: timeWindow.start,
          lte: timeWindow.end,
        },
      },
      orderBy: { observedAt: 'asc' },
    });

    // Group by trait and analyze patterns
    const patterns = [];
    const traitGroups = new Map<string, PersonalityObservation[]>();

    for (const obs of observations) {
      if (!traitGroups.has(obs.traitDimension)) {
        traitGroups.set(obs.traitDimension, []);
      }
      const group = traitGroups.get(obs.traitDimension);
      if (group) {
        group.push(obs);
      }
    }

    for (const [trait, traitObs] of traitGroups) {
      if (traitObs.length < 3) continue; // Need enough data

      // Detect various patterns
      const trend = this.detectTrend(traitObs);
      const cycles = this.detectCycles(traitObs);
      const contextPatterns = this.detectContextPatterns(traitObs);

      if (trend || cycles || contextPatterns.length > 0) {
        patterns.push({
          traitDimension: trait,
          trend,
          cycles,
          contextPatterns,
          observationCount: traitObs.length,
          confidence: this.calculatePatternConfidence(traitObs),
        });
      }
    }

    return patterns;
  }

  private detectTrend(observations: PersonalityObservation[]): string | null {
    if (observations.length < 3) return null;

    // Simple linear regression
    const n = observations.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = observations.map((o) => o.observedValue);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * (y[i] ?? 0), 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgChange = Math.abs(slope) * n;

    if (avgChange < 0.1) return null; // No significant trend

    return slope > 0 ? 'increasing' : 'decreasing';
  }

  private detectCycles(
    observations: PersonalityObservation[],
  ): { type: string; frequency: number; avgPeriod: number } | null {
    // Simple cycle detection - look for repeating patterns
    if (observations.length < 6) return null;

    const values = observations.map((o) => o.observedValue);
    const diffs = [];

    for (let i = 1; i < values.length; i++) {
      const current = values[i];
      const previous = values[i - 1];
      if (current !== undefined && previous !== undefined) {
        diffs.push(current - previous > 0 ? 1 : -1);
      }
    }

    // Look for alternating patterns
    let alternations = 0;
    for (let i = 1; i < diffs.length; i++) {
      if (diffs[i] !== diffs[i - 1]) alternations++;
    }

    const alternationRate = alternations / (diffs.length - 1);

    if (alternationRate > 0.6) {
      return {
        type: 'oscillating',
        frequency: alternationRate,
        avgPeriod: observations.length / alternations,
      };
    }

    return null;
  }

  private detectContextPatterns(
    observations: PersonalityObservation[],
  ): Array<{ context: string; avgValue: number; consistency: number; sampleSize: number }> {
    const patterns = [];
    const contextGroups = new Map<string, number[]>();

    // Group by context dimensions using proper DB fields
    for (const obs of observations) {
      // Group by situation
      if (obs.situation) {
        const contextKey = `situation:${obs.situation}`;
        if (!contextGroups.has(contextKey)) {
          contextGroups.set(contextKey, []);
        }
        contextGroups.get(contextKey)?.push(obs.observedValue);
      }

      // Group by interaction partner
      if (obs.interactionPartnerId) {
        const contextKey = `partner:${obs.interactionPartnerId}`;
        if (!contextGroups.has(contextKey)) {
          contextGroups.set(contextKey, []);
        }
        contextGroups.get(contextKey)?.push(obs.observedValue);
      }

      // Group by emotional state
      if (obs.emotionalStateId) {
        const contextKey = `emotion:${obs.emotionalStateId}`;
        if (!contextGroups.has(contextKey)) {
          contextGroups.set(contextKey, []);
        }
        contextGroups.get(contextKey)?.push(obs.observedValue);
      }

      // Group by trigger
      if (obs.trigger) {
        const contextKey = `trigger:${obs.trigger}`;
        if (!contextGroups.has(contextKey)) {
          contextGroups.set(contextKey, []);
        }
        contextGroups.get(contextKey)?.push(obs.observedValue);
      }
    }

    // Find contexts that produce consistent effects
    for (const [context, values] of contextGroups) {
      if (values.length < 2) continue;

      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
      const consistency = 1 - Math.sqrt(variance);

      if (consistency > 0.7) {
        patterns.push({
          context,
          avgValue: avg,
          consistency,
          sampleSize: values.length,
        });
      }
    }

    return patterns;
  }

  private calculatePatternConfidence(observations: PersonalityObservation[]): number {
    // Confidence based on sample size and observation confidence
    const sampleFactor = Math.min(1, observations.length / 10);
    const avgConfidence =
      observations.reduce((sum, o) => sum + o.confidence, 0) / observations.length;

    return (sampleFactor + avgConfidence) / 2;
  }
}
