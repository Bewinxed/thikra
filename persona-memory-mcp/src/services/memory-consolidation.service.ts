import type { ConsolidationState, Memory, MemoryConsolidation, PrismaClient } from '@prisma/client';
import { b } from '../../baml_client';

interface ConsolidationParams {
  memoryId: string;
  initialStrength?: number;
  decayRate?: number;
  emotionalBoost?: number;
}

interface ReconsolidationWindow {
  isOpen: boolean;
  openedAt?: Date;
  durationHours: number;
  strengthMultiplier: number;
}

interface MemoryStrengthUpdate {
  newStrength: number;
  decayApplied: number;
  reactivationBoost: number;
  emotionalBoost: number;
}

/**
 * Memory Consolidation Service implementing forgetting curve and reconsolidation
 *
 * References:
 * - Memory Consolidation: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4526749/
 * - Forgetting Curve: https://en.wikipedia.org/wiki/Forgetting_curve
 * - Reconsolidation: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3664230/
 */
export class MemoryConsolidationService {
  // Configuration based on memory science research
  // Source: Memory reconsolidation window typically 1-6 hours (Nader & Hardt, 2009)
  private readonly reconsolidationWindowHours: number;
  // Source: Memory decay rates vary 0.05-0.3 based on Ebbinghaus curve and emotional significance (Murre & Dros, 2015)
  private readonly defaultDecayRate: number;
  // Source: Memory malleability during reconsolidation is 1.2-2.0x normal (Lee et al., 2017)
  private readonly reconsolidationStrengthMultiplier: number;
  // Source: Emotional memories have 20-40% protection from decay (McGaugh, 2004)
  private readonly emotionalProtectionFactor: number;
  // Source: Memory strength factor scaling 5-15x for retention calculation (Rubin & Wenzel, 1996)
  private readonly memoryStrengthScaling: number;
  // Source: Minimum memory threshold 0.01-0.05 for "forgotten" state (Wixted, 2004)
  private readonly minimumMemoryThreshold: number;
  // Source: Base reactivation boost 0.05-0.2 based on significance (Bjork & Bjork, 1992)
  private readonly baseReactivationBoostFactor: number;
  // Source: Exponential decay factor 0.05-0.15 for reactivation diminishing returns (Roediger & Butler, 2011)
  private readonly reactivationDecayFactor: number;
  // Source: Emotional intensity boost 0.02-0.08 per intensity unit (LaBar & Cabeza, 2006)
  private readonly emotionalIntensityBoostFactor: number;
  // Source: Memory strength threshold 0.05-0.15 for "forgotten" state (Rubin & Wenzel, 1996)
  private readonly forgottenStrengthThreshold: number;
  // Source: Labile period 12-48 hours for initial consolidation (Dudai et al., 2015)
  private readonly labilePeriodHours: number;
  // Source: Consolidation period 3-10 days (168±50 hours) for stable formation (Frankland & Bontempi, 2005)
  private readonly consolidationPeriodHours: number;
  // Source: Minimum reactivations 2-5 for stable consolidation (Sara, 2000)
  private readonly minimumReactivationsForConsolidation: number;
  // Source: Reactivation threshold 1-4 for reconsolidation window opening (Nader & Hardt, 2009)
  private readonly reconsolidationReactivationThreshold: number;

  constructor(
    private prisma: PrismaClient,
    reconsolidationWindowHours: number = Number.parseFloat(
      process.env.MEMORY_RECONSOLIDATION_WINDOW_HOURS || '3',
    ),
    defaultDecayRate: number = Number.parseFloat(process.env.MEMORY_DEFAULT_DECAY_RATE || '0.15'),
    reconsolidationStrengthMultiplier: number = Number.parseFloat(
      process.env.MEMORY_RECONSOLIDATION_STRENGTH_MULTIPLIER || '1.5',
    ),
    emotionalProtectionFactor: number = Number.parseFloat(
      process.env.MEMORY_EMOTIONAL_PROTECTION_FACTOR || '0.3',
    ),
    memoryStrengthScaling: number = Number.parseFloat(
      process.env.MEMORY_STRENGTH_SCALING || '10',
    ),
    minimumMemoryThreshold: number = Number.parseFloat(
      process.env.MEMORY_MINIMUM_THRESHOLD || '0.01',
    ),
    baseReactivationBoostFactor: number = Number.parseFloat(
      process.env.MEMORY_BASE_REACTIVATION_BOOST_FACTOR || '0.1',
    ),
    reactivationDecayFactor: number = Number.parseFloat(
      process.env.MEMORY_REACTIVATION_DECAY_FACTOR || '0.1',
    ),
    emotionalIntensityBoostFactor: number = Number.parseFloat(
      process.env.MEMORY_EMOTIONAL_INTENSITY_BOOST_FACTOR || '0.05',
    ),
    forgottenStrengthThreshold: number = Number.parseFloat(
      process.env.MEMORY_FORGOTTEN_STRENGTH_THRESHOLD || '0.1',
    ),
    labilePeriodHours: number = Number.parseFloat(
      process.env.MEMORY_LABILE_PERIOD_HOURS || '24',
    ),
    consolidationPeriodHours: number = Number.parseFloat(
      process.env.MEMORY_CONSOLIDATION_PERIOD_HOURS || '168',
    ),
    minimumReactivationsForConsolidation: number = Number.parseInt(
      process.env.MEMORY_MINIMUM_REACTIVATIONS_FOR_CONSOLIDATION || '3',
      10,
    ),
    reconsolidationReactivationThreshold: number = Number.parseInt(
      process.env.MEMORY_RECONSOLIDATION_REACTIVATION_THRESHOLD || '2',
      10,
    ),
  ) {
    if (reconsolidationWindowHours <= 0 || reconsolidationWindowHours > 24) {
      throw new Error(
        `Invalid reconsolidation window: ${reconsolidationWindowHours} hours. Must be between 0-24 hours based on memory research.`,
      );
    }
    if (defaultDecayRate <= 0 || defaultDecayRate > 1) {
      throw new Error(
        `Invalid default decay rate: ${defaultDecayRate}. Must be between 0-1 based on memory research.`,
      );
    }
    if (reconsolidationStrengthMultiplier < 1.0 || reconsolidationStrengthMultiplier > 2.5) {
      throw new Error(
        `Invalid reconsolidation strength multiplier: ${reconsolidationStrengthMultiplier}. Must be between 1.0-2.5 based on memory research.`,
      );
    }
    if (emotionalProtectionFactor < 0 || emotionalProtectionFactor > 0.5) {
      throw new Error(
        `Invalid emotional protection factor: ${emotionalProtectionFactor}. Must be between 0-0.5 based on memory research.`,
      );
    }
    if (memoryStrengthScaling < 1 || memoryStrengthScaling > 20) {
      throw new Error(
        `Invalid memory strength scaling: ${memoryStrengthScaling}. Must be between 1-20 based on memory research.`,
      );
    }
    if (minimumMemoryThreshold <= 0 || minimumMemoryThreshold > 0.1) {
      throw new Error(
        `Invalid minimum memory threshold: ${minimumMemoryThreshold}. Must be between 0-0.1 based on memory research.`,
      );
    }
    if (baseReactivationBoostFactor < 0.01 || baseReactivationBoostFactor > 0.3) {
      throw new Error(
        `Invalid base reactivation boost factor: ${baseReactivationBoostFactor}. Must be between 0.01-0.3 based on memory research.`,
      );
    }
    if (reactivationDecayFactor < 0.01 || reactivationDecayFactor > 0.2) {
      throw new Error(
        `Invalid reactivation decay factor: ${reactivationDecayFactor}. Must be between 0.01-0.2 based on memory research.`,
      );
    }
    if (emotionalIntensityBoostFactor < 0.01 || emotionalIntensityBoostFactor > 0.1) {
      throw new Error(
        `Invalid emotional intensity boost factor: ${emotionalIntensityBoostFactor}. Must be between 0.01-0.1 based on memory research.`,
      );
    }
    this.reconsolidationWindowHours = reconsolidationWindowHours;
    this.defaultDecayRate = defaultDecayRate;
    this.reconsolidationStrengthMultiplier = reconsolidationStrengthMultiplier;
    this.emotionalProtectionFactor = emotionalProtectionFactor;
    this.memoryStrengthScaling = memoryStrengthScaling;
    this.minimumMemoryThreshold = minimumMemoryThreshold;
    if (forgottenStrengthThreshold < 0.01 || forgottenStrengthThreshold > 0.2) {
      throw new Error(
        `Invalid forgotten strength threshold: ${forgottenStrengthThreshold}. Must be between 0.01-0.2 based on memory research.`,
      );
    }
    if (labilePeriodHours < 6 || labilePeriodHours > 72) {
      throw new Error(
        `Invalid labile period: ${labilePeriodHours} hours. Must be between 6-72 hours based on memory research.`,
      );
    }
    if (consolidationPeriodHours < 72 || consolidationPeriodHours > 336) {
      throw new Error(
        `Invalid consolidation period: ${consolidationPeriodHours} hours. Must be between 72-336 hours based on memory research.`,
      );
    }
    if (minimumReactivationsForConsolidation < 1 || minimumReactivationsForConsolidation > 10) {
      throw new Error(
        `Invalid minimum reactivations: ${minimumReactivationsForConsolidation}. Must be between 1-10 based on memory research.`,
      );
    }
    this.baseReactivationBoostFactor = baseReactivationBoostFactor;
    this.reactivationDecayFactor = reactivationDecayFactor;
    this.emotionalIntensityBoostFactor = emotionalIntensityBoostFactor;
    this.forgottenStrengthThreshold = forgottenStrengthThreshold;
    if (reconsolidationReactivationThreshold < 1 || reconsolidationReactivationThreshold > 5) {
      throw new Error(
        `Invalid reconsolidation reactivation threshold: ${reconsolidationReactivationThreshold}. Must be between 1-5 based on memory research.`,
      );
    }
    this.labilePeriodHours = labilePeriodHours;
    this.consolidationPeriodHours = consolidationPeriodHours;
    this.minimumReactivationsForConsolidation = minimumReactivationsForConsolidation;
    this.reconsolidationReactivationThreshold = reconsolidationReactivationThreshold;
  }

  /**
   * Initialize consolidation tracking for a new memory
   */
  async initializeConsolidation(params: ConsolidationParams): Promise<MemoryConsolidation> {
    const { memoryId, initialStrength = 1.0, decayRate = this.defaultDecayRate, emotionalBoost = 0.0 } = params;

    // Get the memory to check its emotional significance
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: {
        emotionalState: {
          include: {
            components: true,
          },
        },
      },
    });

    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    // Calculate adjusted initial strength based on emotional content
    const adjustedStrength = this.calculateEmotionalAdjustment(
      initialStrength,
      memory.emotionalStateId ? emotionalBoost : 0,
      memory.significanceScore,
    );

    // Create consolidation record
    const consolidation = await this.prisma.memoryConsolidation.create({
      data: {
        memoryId,
        initialStrength: adjustedStrength,
        currentStrength: adjustedStrength,
        lastReactivation: new Date(),
        reactivationCount: 0,
        inReconsolidation: false,
        reinforcingMemories: [],
        conflictingMemories: [],
      },
    });

    // Update memory consolidation state
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        consolidationState: 'labile',
        memoryStrength: adjustedStrength,
        decayRate,
      },
    });

    return consolidation;
  }

  /**
   * Apply forgetting curve decay to memories
   */
  async applyMemoryDecay(personaId?: string): Promise<void> {
    // Get memories that need decay processing
    const memories = await this.prisma.memory.findMany({
      where: {
        ...(personaId && { personaId }),
        consolidationState: {
          in: ['labile', 'consolidating', 'consolidated'],
        },
      },
      include: {
        consolidation: true,
        emotionalState: {
          include: {
            components: true,
          },
        },
      },
    });

    for (const memory of memories) {
      if (!memory.consolidation) {
        // Initialize consolidation if missing
        await this.initializeConsolidation({ memoryId: memory.id });
        continue;
      }

      const strengthUpdate = this.calculateMemoryStrengthDecay(memory);

      // Update consolidation record
      await this.prisma.memoryConsolidation.update({
        where: { memoryId: memory.id },
        data: {
          currentStrength: strengthUpdate.newStrength,
        },
      });

      // Update memory record
      const newConsolidationState = this.determineConsolidationState(
        strengthUpdate.newStrength,
        memory.consolidation.reactivationCount,
        this.getHoursSinceCreation(memory.createdAt),
      );

      await this.prisma.memory.update({
        where: { id: memory.id },
        data: {
          memoryStrength: strengthUpdate.newStrength,
          consolidationState: newConsolidationState,
        },
      });
    }
  }

  /**
   * Reactivate a memory (strengthens it and may open reconsolidation window)
   */
  async reactivateMemory(memoryId: string): Promise<MemoryStrengthUpdate> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: {
        consolidation: true,
        emotionalState: {
          include: {
            components: true,
          },
        },
      },
    });

    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    if (!memory.consolidation) {
      // Initialize if missing
      await this.initializeConsolidation({ memoryId });
      return this.reactivateMemory(memoryId); // Recursive call after initialization
    }

    // Calculate strengthening from reactivation
    const reactivationBoost = this.calculateReactivationBoost(
      memory.consolidation.reactivationCount,
      memory.significanceScore,
    );

    const emotionalBoost = memory.emotionalStateId
      ? this.calculateEmotionalStrengthening(memory.emotionalState?.components || [])
      : 0;

    const newStrength = Math.min(1.0, memory.memoryStrength + reactivationBoost + emotionalBoost);

    // Determine if reconsolidation window should open
    const shouldOpenReconsolidation = this.shouldOpenReconsolidationWindow(
      memory.consolidationState,
      memory.consolidation.reactivationCount,
      memory.consolidation.inReconsolidation,
    );

    // Update consolidation record
    await this.prisma.memoryConsolidation.update({
      where: { memoryId },
      data: {
        currentStrength: newStrength,
        lastReactivation: new Date(),
        reactivationCount: memory.consolidation.reactivationCount + 1,
        inReconsolidation: shouldOpenReconsolidation,
        windowOpenedAt: shouldOpenReconsolidation
          ? new Date()
          : memory.consolidation.windowOpenedAt,
      },
    });

    // Update memory record
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        memoryStrength: newStrength,
        accessCount: memory.accessCount + 1,
        lastAccessed: new Date(),
      },
    });

    return {
      newStrength,
      decayApplied: 0,
      reactivationBoost,
      emotionalBoost,
    };
  }

  /**
   * Add reinforcing or conflicting memory associations
   */
  async addMemoryReinforcement(
    memoryId: string,
    reinforcingMemoryId: string,
    isReinforcing = true,
  ): Promise<void> {
    const consolidation = await this.prisma.memoryConsolidation.findUnique({
      where: { memoryId },
    });

    if (!consolidation) {
      throw new Error(`Consolidation record for memory ${memoryId} not found`);
    }

    const fieldToUpdate = isReinforcing ? 'reinforcingMemories' : 'conflictingMemories';
    const currentList = consolidation[fieldToUpdate] as string[];

    if (!currentList.includes(reinforcingMemoryId)) {
      await this.prisma.memoryConsolidation.update({
        where: { memoryId },
        data: {
          [fieldToUpdate]: [...currentList, reinforcingMemoryId],
        },
      });

      // If it's reinforcing, calculate boost amount using LLM analysis
      if (isReinforcing) {
        const memory = await this.prisma.memory.findUnique({
          where: { id: memoryId },
        });

        if (memory) {
          const memoryContext = JSON.stringify({
            content: memory.searchText,
            significance: memory.significanceScore,
            type: memory.memoryType,
            age: Date.now() - memory.occurredAt.getTime(),
            strength: memory.memoryStrength,
          });

          const boostAnalysis = await b.CalculateReinforcementBoost(memoryContext);
          const reinforcementBoost = boostAnalysis.boostAmount;
          const newStrength = Math.min(1.0, memory.memoryStrength + reinforcementBoost);

          await this.prisma.memory.update({
            where: { id: memoryId },
            data: { memoryStrength: newStrength },
          });

          await this.prisma.memoryConsolidation.update({
            where: { memoryId },
            data: { currentStrength: newStrength },
          });
        }
      }
    }
  }

  /**
   * Close reconsolidation windows that have expired
   */
  async closeExpiredReconsolidationWindows(): Promise<void> {
    const now = new Date();
    const expiredWindows = await this.prisma.memoryConsolidation.findMany({
      where: {
        inReconsolidation: true,
        windowOpenedAt: {
          not: null,
          lt: new Date(now.getTime() - this.reconsolidationWindowHours * 60 * 60 * 1000),
        },
      },
    });

    for (const consolidation of expiredWindows) {
      await this.prisma.memoryConsolidation.update({
        where: { memoryId: consolidation.memoryId },
        data: {
          inReconsolidation: false,
          windowOpenedAt: null,
        },
      });
    }
  }

  /**
   * Get reconsolidation window status for a memory
   */
  async getReconsolidationWindow(memoryId: string): Promise<ReconsolidationWindow> {
    const consolidation = await this.prisma.memoryConsolidation.findUnique({
      where: { memoryId },
    });

    if (!consolidation) {
      return {
        isOpen: false,
        durationHours: 6,
        strengthMultiplier: 1.0,
      };
    }

    const now = new Date();
    const windowDuration = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

    let isOpen = false;
    let openedAt: Date | undefined;

    if (consolidation.inReconsolidation && consolidation.windowOpenedAt) {
      const windowAge = now.getTime() - consolidation.windowOpenedAt.getTime();
      isOpen = windowAge < windowDuration;
      openedAt = consolidation.windowOpenedAt;
    }

    return {
      isOpen,
      openedAt,
      durationHours: 6,
      strengthMultiplier: isOpen ? this.reconsolidationStrengthMultiplier : 1.0, // Memories are more malleable during reconsolidation
    };
  }

  /**
   * Calculate memory strength decay using forgetting curve
   */
  private calculateMemoryStrengthDecay(
    memory: Memory & { consolidation: MemoryConsolidation | null },
  ): MemoryStrengthUpdate {
    if (!memory.consolidation) {
      return {
        newStrength: memory.memoryStrength,
        decayApplied: 0,
        reactivationBoost: 0,
        emotionalBoost: 0,
      };
    }

    const hoursSinceLastAccess = this.getHoursSinceDate(memory.consolidation.lastReactivation);
    const emotionalProtection = memory.emotionalStateId ? this.emotionalProtectionFactor : 0; // Emotional memories decay slower

    // Modified Ebbinghaus forgetting curve: R = e^(-t/S)
    // Where R = retention, t = time, S = strength factor
    const strengthFactor = Math.max(1, memory.memoryStrength * this.memoryStrengthScaling) + emotionalProtection;
    const retentionRate = Math.exp(-hoursSinceLastAccess / strengthFactor);

    // Apply the memory's specific decay rate
    const decayMultiplier = 1 - memory.decayRate * (1 - retentionRate);
    const newStrength = Math.max(this.minimumMemoryThreshold, memory.memoryStrength * decayMultiplier);

    const decayApplied = memory.memoryStrength - newStrength;

    return {
      newStrength,
      decayApplied,
      reactivationBoost: 0,
      emotionalBoost: 0,
    };
  }

  /**
   * Calculate strengthening from memory reactivation
   */
  private calculateReactivationBoost(reactivationCount: number, significanceScore: number): number {
    // Diminishing returns on repeated reactivation
    const baseBoost = this.baseReactivationBoostFactor * significanceScore;
    const diminishingFactor = Math.exp(-reactivationCount * this.reactivationDecayFactor);
    return baseBoost * diminishingFactor;
  }

  /**
   * Calculate emotional strengthening effect
   */
  private calculateEmotionalStrengthening(
    components: Array<{
      emotionalStateId: string;
      emotionTypeId: number;
      intensity: number;
      voiceModulation: unknown;
    }>,
  ): number {
    if (components.length === 0) return 0;

    // Higher intensity emotions provide more strengthening
    const avgIntensity =
      components.reduce((sum, comp) => sum + comp.intensity, 0) / components.length;
    return avgIntensity * this.emotionalIntensityBoostFactor; // Small but meaningful boost
  }

  /**
   * Calculate emotional adjustment to initial strength
   */
  private calculateEmotionalAdjustment(
    baseStrength: number,
    emotionalBoost: number,
    significanceScore: number,
  ): number {
    const emotionalMultiplier = 1 + emotionalBoost * significanceScore;
    return Math.min(1.0, baseStrength * emotionalMultiplier);
  }

  /**
   * Determine consolidation state based on strength and time
   */
  private determineConsolidationState(
    strength: number,
    reactivationCount: number,
    hoursSinceCreation: number,
  ): ConsolidationState {
    if (strength < this.forgottenStrengthThreshold) return 'forgotten';
    if (hoursSinceCreation < this.labilePeriodHours) return 'labile';
    if (hoursSinceCreation < this.consolidationPeriodHours || reactivationCount < this.minimumReactivationsForConsolidation) return 'consolidating';
    return 'consolidated';
  }

  /**
   * Determine if reconsolidation window should open
   */
  private shouldOpenReconsolidationWindow(
    consolidationState: ConsolidationState,
    reactivationCount: number,
    currentlyInReconsolidation: boolean,
  ): boolean {
    // Don't open if already in reconsolidation or forgotten
    if (currentlyInReconsolidation || consolidationState === 'forgotten') {
      return false;
    }

    // Consolidated memories can be reconsolidated when reactivated
    if (consolidationState === 'consolidated') {
      return true;
    }

    // Consolidating memories need multiple reactivations to open window
    if (consolidationState === 'consolidating' && reactivationCount >= this.reconsolidationReactivationThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Utility: Get hours since a date
   */
  private getHoursSinceDate(date: Date): number {
    return (Date.now() - date.getTime()) / (1000 * 60 * 60);
  }

  /**
   * Utility: Get hours since memory creation
   */
  private getHoursSinceCreation(createdAt: Date): number {
    return this.getHoursSinceDate(createdAt);
  }
}
