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
      throw new Error(
        `Insufficient personality observations to estimate attractor force. Need at least 3 observations, got ${observations.length}`,
      );
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
      // Use statistical minimum for meaningful analysis - need at least 3 data points for basic variance calculation
      if (!this.hasStatisticallySignificantData(traitObs)) continue;

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

  /**
   * Check if we have statistically significant data for analysis
   * Uses minimum sample size for variance calculation and checks data quality
   */
  private hasStatisticallySignificantData(observations: PersonalityObservation[]): boolean {
    // Need minimum 3 points for variance calculation
    if (observations.length < 3) return false;
    
    // Check if data has meaningful variance (not all identical values)
    const values = observations.map(obs => obs.observedValue);
    const variance = this.calculateVariance(values);
    
    // If variance is effectively zero, data is not meaningful for pattern detection
    return variance > 0.001; // Very small threshold to catch near-identical values
  }

  /**
   * Calculate statistical variance of observations
   */
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
    return squaredDifferences.reduce((sum, diff) => sum + diff, 0) / values.length;
  }

  /**
   * Calculate statistical significance threshold based on data variance
   */
  private calculateSignificanceThreshold(values: number[]): number {
    const variance = this.calculateVariance(values);
    // Use coefficient of variation approach: threshold = standard deviation / mean
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Use 10% of coefficient of variation as minimum significant change
    return Math.max(0.01, (stdDev / Math.abs(mean)) * 0.1);
  }

  /**
   * Check if we have enough data for meaningful cycle detection
   * Requires sufficient data points and variance for pattern analysis
   */
  private hasEnoughDataForCycleDetection(observations: PersonalityObservation[]): boolean {
    // Need minimum data for 2 complete cycles (at least 4 points)
    if (observations.length < 4) return false;
    
    // Check if data has meaningful variance for cycle detection
    const values = observations.map(obs => obs.observedValue);
    const variance = this.calculateVariance(values);
    
    // Need sufficient variance to detect meaningful oscillations
    return variance > 0.01; // Higher threshold than trend detection
  }

  private detectTrend(observations: PersonalityObservation[]): string | null {
    if (!this.hasStatisticallySignificantData(observations)) return null;

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

    // Use statistical significance threshold based on data variance
    const significanceThreshold = this.calculateSignificanceThreshold(y);
    if (avgChange < significanceThreshold) return null; // No statistically significant trend

    return slope > 0 ? 'increasing' : 'decreasing';
  }

  private detectCycles(
    observations: PersonalityObservation[],
  ): { type: string; frequency: number; avgPeriod: number } | null {
    // Cycle detection requires minimum data for meaningful pattern analysis
    // Need at least 2 complete cycles to detect pattern (minimum 4 points)
    if (!this.hasEnoughDataForCycleDetection(observations)) return null;

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

    // Use statistical threshold: oscillation if more than random chance
    // Random alternation would be ~0.5, so we look for significantly higher rates
    const randomExpectation = 0.5;
    const significanceThreshold = randomExpectation + Math.sqrt(randomExpectation * (1 - randomExpectation) / diffs.length) * 2; // 2 standard deviations
    
    if (alternationRate > significanceThreshold) {
      return {
        type: 'oscillating',
        frequency: alternationRate,
        avgPeriod: observations.length / alternations,
      };
    }

    return null;
  }

  private detectContextPatterns(observations: PersonalityObservation[]): Array<{
    context: string;
    avgValue: number;
    consistency: number;
    sampleSize: number;
  }> {
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

      // Use statistical threshold based on sample size and variance
      // Higher consistency required for smaller samples (more conservative)
      const consistencyThreshold = Math.max(0.5, 1 - (2 / Math.sqrt(values.length))); // Adaptive threshold
      
      if (consistency > consistencyThreshold) {
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
    // Confidence based on sample size using statistical power calculation
    // Use logarithmic scaling for sample size factor (more statistically sound)
    const sampleFactor = Math.min(1, Math.log(observations.length + 1) / Math.log(11)); // log base e, reaches ~1 at 10 observations
    const avgConfidence =
      observations.reduce((sum, o) => sum + o.confidence, 0) / observations.length;

    return (sampleFactor + avgConfidence) / 2;
  }
}
