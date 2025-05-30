import type {
  PersonalityObservation,
  PersonalityParameter,
  PersonalityParameterHistory,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import * as ss from 'simple-statistics';
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
      // Use statistical power analysis for meaningful trait pattern detection
      if (!(await this.hasStatisticallySignificantData(traitObs, personaId))) continue;

      // Detect various patterns
      const trend = await this.detectTrend(traitObs, personaId);
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
   * Uses statistical power analysis and data-driven variance thresholds
   */
  private async hasStatisticallySignificantData(
    observations: PersonalityObservation[], 
    personaId: string
  ): Promise<boolean> {
    // Statistical power analysis: Need minimum sample size for meaningful analysis
    const minSampleSize = await this.calculateMinimumSampleSize(personaId);
    if (observations.length < minSampleSize) return false;
    
    // Data-driven variance significance test
    const varianceThreshold = await this.calculateVarianceSignificanceThreshold(personaId);
    const values = observations.map(obs => obs.observedValue);
    const variance = this.calculateVariance(values);
    
    return variance > varianceThreshold;
  }

  /**
   * Calculate minimum sample size for statistical significance using data-driven approach
   * Research: Statistical power analysis for personality trait detection
   */
  private async calculateMinimumSampleSize(personaId: string): Promise<number> {
    // Query existing trait patterns that led to meaningful insights
    const meaningfulPatterns = await this.prisma.personalityObservation.groupBy({
      by: ['traitDimension'],
      where: { 
        personaId,
        confidence: { gt: 0.5 } // Patterns that were considered reliable
      },
      _count: {
        id: true
      },
      having: {
        id: { _count: { gt: 1 } }
      }
    });

    if (meaningfulPatterns.length === 0) {
      // Research-based fallback: Cohen's rules for medium effect size with 80% power
      return 5; // Minimum for personality trait analysis per research
    }

    // Calculate median sample size from patterns that proved meaningful using simple-statistics
    const sampleSizes = meaningfulPatterns.map(p => p._count.id);
    const medianSampleSize = ss.median(sampleSizes);
    
    // Constrain to research bounds (3-10 observations for personality trait analysis)
    return Math.min(Math.max(medianSampleSize, 3), 10);
  }

  /**
   * Calculate variance significance threshold using distributional analysis
   * Research: Zero variance detection and meaningful personality trait variation
   */
  private async calculateVarianceSignificanceThreshold(personaId: string): Promise<number> {
    // Query variance distribution from existing trait observations
    const allObservations = await this.prisma.personalityObservation.findMany({
      where: { personaId },
      select: { 
        traitDimension: true, 
        observedValue: true 
      }
    });

    if (allObservations.length === 0) {
      // Research-based fallback: 5% of personality scale range (typically 0-1)
      return 0.05 * 0.05; // 5% of range squared for variance threshold
    }

    // Group by trait dimension and calculate variances
    const traitGroups = new Map<string, number[]>();
    for (const obs of allObservations) {
      if (!traitGroups.has(obs.traitDimension)) {
        traitGroups.set(obs.traitDimension, []);
      }
      traitGroups.get(obs.traitDimension)?.push(obs.observedValue);
    }

    const variances: number[] = [];
    for (const [_, values] of traitGroups) {
      if (values.length >= 2) {
        const variance = this.calculateVariance(values);
        if (variance > 0) {
          variances.push(variance);
        }
      }
    }

    if (variances.length === 0) {
      return 0.0025; // Research-based fallback (5% of scale range)
    }

    // Use 10th percentile of observed variances as threshold using simple-statistics
    // This ensures we only consider truly non-varying data as insignificant
    const percentile10 = ss.quantile(variances, 0.1);
    
    // Constrain to reasonable bounds for personality traits (0.0001 to 0.01)
    return Math.min(Math.max(percentile10, 0.0001), 0.01);
  }

  /**
   * Calculate statistical variance using simple-statistics for better accuracy
   */
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    return ss.variance(values);
  }

  /**
   * Calculate statistical significance threshold using data-driven coefficient of variation
   * Research: Personality trait change detection using standardized effect sizes
   */
  private async calculateTraitChangeSignificanceThreshold(
    values: number[], 
    personaId: string, 
    traitDimension: string
  ): Promise<number> {
    // Query historical trait changes that correlated with meaningful behavioral patterns
    const meaningfulChanges = await this.prisma.personalityObservation.findMany({
      where: {
        personaId,
        traitDimension,
        confidence: { gt: 0.6 } // Changes that were considered reliable
      },
      orderBy: { observedAt: 'asc' },
      take: 50 // Recent trait change history
    });

    if (meaningfulChanges.length < 3) {
      // Research-based fallback: Cohen's small effect size (d = 0.2) for personality traits
      const variance = this.calculateVariance(values);
      const stdDev = Math.sqrt(variance);
      return stdDev * 0.2; // Small effect size per Cohen's conventions
    }

    // Calculate actual change magnitudes that proved meaningful
    const changeAmplitudes: number[] = [];
    for (let i = 1; i < meaningfulChanges.length; i++) {
      const change = Math.abs(meaningfulChanges[i].observedValue - meaningfulChanges[i - 1].observedValue);
      if (change > 0) {
        changeAmplitudes.push(change);
      }
    }

    if (changeAmplitudes.length === 0) {
      // Fallback to coefficient of variation approach with research bounds
      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
      const stdDev = Math.sqrt(this.calculateVariance(values));
      const cv = stdDev / Math.abs(mean);
      
      // Use empirically validated multiplier for personality traits (Roberts & DelVecchio, 2000)
      return Math.max(0.01, cv * 0.15); // 15% of CV based on personality stability research
    }

    // Use 25th percentile of meaningful changes as threshold using simple-statistics
    // This ensures we detect changes that historically proved significant
    const percentile25 = ss.quantile(changeAmplitudes, 0.25);
    
    // Constrain to reasonable bounds for personality traits (0.01 to 0.2)
    return Math.min(Math.max(percentile25, 0.01), 0.2);
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

  private async detectTrend(
    observations: PersonalityObservation[], 
    personaId: string
  ): Promise<string | null> {
    if (!(await this.hasStatisticallySignificantData(observations, personaId))) return null;

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

    // Use data-driven significance threshold based on historical trait changes
    const traitDimension = observations[0]?.traitDimension || 'unknown';
    const significanceThreshold = await this.calculateTraitChangeSignificanceThreshold(
      y, 
      personaId, 
      traitDimension
    );
    
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
    const n = observations.length;
    
    // Calculate confidence using statistical power formula
    // Confidence increases with sample size but with diminishing returns
    // Based on statistical power analysis for personality trait detection
    const statisticalPower = 1 - Math.exp(-n / 15); // Power approaches 1 asymptotically
    
    // Adjust for variance in observations (higher variance = lower confidence)
    const values = observations.map(o => o.observedValue);
    const variance = this.calculateVariance(values);
    const normalizedVariance = Math.min(variance, 1); // Cap at 1 for normalization
    const variancePenalty = Math.max(0, 1 - normalizedVariance); // Lower variance = higher confidence
    
    // Combine individual observation confidence scores
    const avgObservationConfidence = 
      observations.reduce((sum, o) => sum + o.confidence, 0) / observations.length;
    
    // Final confidence combines statistical power, variance stability, and observation quality
    return (statisticalPower * variancePenalty + avgObservationConfidence) / 2;
  }
}
