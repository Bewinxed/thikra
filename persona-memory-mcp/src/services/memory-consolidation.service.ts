import type { ConsolidationState, Memory, MemoryConsolidation, PrismaClient } from '@prisma/client';

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
  constructor(private prisma: PrismaClient) {}

  /**
   * Initialize consolidation tracking for a new memory
   */
  async initializeConsolidation(params: ConsolidationParams): Promise<MemoryConsolidation> {
    const { memoryId, initialStrength = 1.0, decayRate = 0.1, emotionalBoost = 0.0 } = params;

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

      // If it's reinforcing, slightly boost the memory strength
      if (isReinforcing) {
        const memory = await this.prisma.memory.findUnique({
          where: { id: memoryId },
        });

        if (memory) {
          const reinforcementBoost = 0.05; // Small boost for reinforcement
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
          lt: new Date(now.getTime() - 6 * 60 * 60 * 1000), // 6 hours ago
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
      strengthMultiplier: isOpen ? 1.5 : 1.0, // Memories are more malleable during reconsolidation
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
    const emotionalProtection = memory.emotionalStateId ? 0.3 : 0; // Emotional memories decay slower

    // Modified Ebbinghaus forgetting curve: R = e^(-t/S)
    // Where R = retention, t = time, S = strength factor
    const strengthFactor = Math.max(1, memory.memoryStrength * 10) + emotionalProtection;
    const retentionRate = Math.exp(-hoursSinceLastAccess / strengthFactor);

    // Apply the memory's specific decay rate
    const decayMultiplier = 1 - memory.decayRate * (1 - retentionRate);
    const newStrength = Math.max(0.01, memory.memoryStrength * decayMultiplier);

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
    const baseBoost = 0.1 * significanceScore;
    const diminishingFactor = Math.exp(-reactivationCount * 0.1);
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
    return avgIntensity * 0.05; // Small but meaningful boost
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
    if (strength < 0.1) return 'forgotten';
    if (hoursSinceCreation < 24) return 'labile';
    if (hoursSinceCreation < 168 || reactivationCount < 3) return 'consolidating'; // 1 week
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
    if (consolidationState === 'consolidating' && reactivationCount >= 2) {
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
