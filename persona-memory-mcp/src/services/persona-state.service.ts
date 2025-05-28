import type { PersonaState, PrismaClient } from '@prisma/client';

/**
 * Simple KV store for persona states
 * Auto-creates states on first reference by LLM
 * Examples: heat_level, arousal, current_mood, visual_memory_strength
 */
export class PersonaStateManager {
  constructor(private prisma: PrismaClient) {}

  /**
   * Set or update a state value
   */
  async setState(
    personaId: string,
    stateKey: string,
    value: any,
    context?: string,
  ): Promise<PersonaState> {
    const existingState = await this.prisma.personaState.findUnique({
      where: {
        personaId_stateKey: {
          personaId: personaId,
          stateKey: stateKey,
        },
      },
    });

    if (existingState) {
      // Update existing state
      return this.prisma.personaState.update({
        where: { id: existingState.id },
        data: {
          stateValue: value,
          description: context || existingState.description,
          lastUpdated: new Date(),
          updateCount: { increment: 1 },
        },
      });
    }

    // Create new state
    const stateType = this.inferStateType(value);
    return this.prisma.personaState.create({
      data: {
        personaId: personaId,
        stateKey: stateKey,
        stateValue: value,
        valueType: stateType,
        description: context,
      },
    });
  }

  /**
   * Get a state value
   */
  async getState(personaId: string, stateKey: string): Promise<any> {
    const state = await this.prisma.personaState.findUnique({
      where: {
        personaId_stateKey: {
          personaId: personaId,
          stateKey: stateKey,
        },
      },
    });
    return state?.stateValue;
  }

  /**
   * Get all states for a persona
   */
  async getAllStates(personaId: string): Promise<PersonaState[]> {
    return this.prisma.personaState.findMany({
      where: { personaId: personaId },
      orderBy: { lastUpdated: 'desc' },
    });
  }

  /**
   * Delete a state
   */
  async deleteState(personaId: string, stateKey: string): Promise<void> {
    await this.prisma.personaState.delete({
      where: {
        personaId_stateKey: {
          personaId: personaId,
          stateKey: stateKey,
        },
      },
    });
  }

  /**
   * Track state change (creates a state change record)
   */
  async trackStateChange(
    stateId: string,
    oldValue: any,
    newValue: any,
    triggerType: string,
    triggerDetails?: any,
    relatedMemoryId?: string,
  ) {
    return this.prisma.personaStateChange.create({
      data: {
        stateId,
        oldValue,
        newValue,
        triggerType,
        triggerDetails,
        relatedMemoryId,
      },
    });
  }

  /**
   * Get state change history
   */
  async getStateHistory(personaId: string, stateKey: string, limit = 100) {
    const state = await this.prisma.personaState.findUnique({
      where: {
        personaId_stateKey: {
          personaId: personaId,
          stateKey: stateKey,
        },
      },
      include: {
        stateChanges: {
          orderBy: { changedAt: 'desc' },
          take: limit,
        },
      },
    });
    return state?.stateChanges || [];
  }

  /**
   * Infer the type of a value
   */
  private inferStateType(value: any): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'numeric';
    if (typeof value === 'string') return 'string';
    if (Array.isArray(value)) return 'array';
    if (value && typeof value === 'object') return 'object';
    return 'unknown';
  }

  /**
   * Set multiple states at once
   */
  async setMultipleStates(
    personaId: string,
    states: Record<string, any>,
    context?: string,
  ): Promise<PersonaState[]> {
    const results: PersonaState[] = [];
    for (const [key, value] of Object.entries(states)) {
      const state = await this.setState(personaId, key, value, context);
      results.push(state);
    }
    return results;
  }

  /**
   * Get multiple states at once
   */
  async getMultipleStates(personaId: string, stateKeys: string[]): Promise<Record<string, any>> {
    const states = await this.prisma.personaState.findMany({
      where: {
        personaId: personaId,
        stateKey: { in: stateKeys },
      },
    });

    const result: Record<string, any> = {};
    for (const state of states) {
      result[state.stateKey] = state.stateValue;
    }
    return result;
  }
}
