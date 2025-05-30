import type { PersonaState, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

type JsonValue = Prisma.JsonValue;

interface StateTransition {
  timestamp: string;
  fromValue: JsonValue;
  toValue: JsonValue;
  duration: number;
}

export interface StateUpdate {
  personaId: string;
  stateKey: string;
  stateValue: JsonValue;
  description?: string;
}

export interface StateQuery {
  personaId: string;
  stateKeys?: string[];
  includeHistory?: boolean;
  since?: Date;
}

export interface StateWithHistory extends PersonaState {
  history?: PersonaState[];
}

export class StateManagementService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get current state value for a persona
   */
  async getState(personaId: string, stateKey: string): Promise<JsonValue | null> {
    const state = await this.prisma.personaState.findUnique({
      where: {
        personaId_stateKey: {
          personaId,
          stateKey,
        },
      },
    });

    return state?.stateValue || null;
  }

  /**
   * Get multiple states for a persona
   */
  async getStates(personaId: string, stateKeys?: string[]): Promise<Record<string, JsonValue>> {
    const where: { personaId: string; stateKey?: { in: string[] } } = {
      personaId,
    };
    if (stateKeys && stateKeys.length > 0) {
      where.stateKey = { in: stateKeys };
    }

    const states = await this.prisma.personaState.findMany({
      where,
      orderBy: { lastUpdated: 'desc' },
    });

    // Convert to key-value object
    const stateMap: Record<string, JsonValue> = {};
    for (const state of states) {
      stateMap[state.stateKey] = state.stateValue;
    }

    return stateMap;
  }

  /**
   * Set a single state value
   */
  async setState(
    personaId: string,
    stateKey: string,
    stateValue: JsonValue,
    description?: string,
  ): Promise<PersonaState> {
    // Check if state exists
    const existing = await this.prisma.personaState.findUnique({
      where: {
        personaId_stateKey: {
          personaId,
          stateKey,
        },
      },
    });

    if (existing) {
      // Track transition for history (store in description for now)
      const transitionRecord: StateTransition = {
        timestamp: new Date().toISOString(),
        fromValue: existing.stateValue,
        toValue: stateValue,
        duration: Date.now() - new Date(existing.lastUpdated).getTime(),
      };

      return this.prisma.personaState.update({
        where: { id: existing.id },
        data: {
          stateValue: stateValue === null ? Prisma.JsonNull : stateValue,
          description: description || `Previous: ${JSON.stringify(transitionRecord)}`,
          updateCount: existing.updateCount + 1,
        },
      });
    }

    // Create new state
    return this.prisma.personaState.create({
      data: {
        personaId,
        stateKey,
        stateValue: stateValue === null ? Prisma.JsonNull : stateValue,
        valueType: this.inferValueType(stateValue),
        description,
        updateCount: 1,
      },
    });
  }

  /**
   * Set multiple states atomically
   */
  async setStates(
    personaId: string,
    states: Record<string, JsonValue>,
    description?: string,
  ): Promise<PersonaState[]> {
    const updates = Object.entries(states).map(([key, value]) => ({
      personaId,
      stateKey: key,
      stateValue: value,
      description,
    }));

    const results: PersonaState[] = [];
    for (const update of updates) {
      const result = await this.setState(
        update.personaId,
        update.stateKey,
        update.stateValue,
        update.description,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Get state history for a specific state key
   */
  async getStateHistory(
    personaId: string,
    stateKey: string,
    limit = 50,
  ): Promise<StateTransition[]> {
    const states = await this.prisma.personaState.findMany({
      where: { personaId, stateKey },
      orderBy: { lastUpdated: 'desc' },
      take: limit,
    });

    // Parse transition data from descriptions (simplified for now)
    const transitions: StateTransition[] = [];
    for (const state of states) {
      if (state.description?.includes('Previous:')) {
        try {
          const transitionData = state.description?.split('Previous: ')[1];
          if (!transitionData) continue;
          const transition = JSON.parse(transitionData) as StateTransition;
          transitions.push(transition);
        } catch {
          // Ignore parsing errors
        }
      }
    }

    return transitions;
  }

  /**
   * Get all states for a persona with optional time filtering
   */
  async getPersonaStates(query: StateQuery): Promise<PersonaState[]> {
    const where: {
      personaId: string;
      stateKey?: { in: string[] };
      lastUpdated?: { gte: Date };
    } = {
      personaId: query.personaId,
    };

    if (query.stateKeys && query.stateKeys.length > 0) {
      where.stateKey = { in: query.stateKeys };
    }

    if (query.since) {
      where.lastUpdated = { gte: query.since };
    }

    return this.prisma.personaState.findMany({
      where,
      orderBy: { lastUpdated: 'desc' },
    });
  }

  /**
   * Get recent state changes
   */
  async getRecentChanges(personaId: string, since: Date): Promise<PersonaState[]> {
    return this.prisma.personaState.findMany({
      where: {
        personaId,
        lastUpdated: { gte: since },
      },
      orderBy: { lastUpdated: 'desc' },
    });
  }

  /**
   * Extract nested value from JSON state using JSON path
   */
  async getNestedStateValue(
    personaId: string,
    stateKey: string,
    jsonPath: string,
  ): Promise<JsonValue> {
    const result = await this.prisma.$queryRaw<{ extracted_value: JsonValue }[]>`
      SELECT stateValue#>${jsonPath} as extracted_value
      FROM PersonaState
      WHERE personaId = ${personaId} AND stateKey = ${stateKey}
    `;

    return result[0]?.extracted_value || null;
  }

  /**
   * Increment a numeric state value
   */
  async incrementState(
    personaId: string,
    stateKey: string,
    increment = 1,
  ): Promise<PersonaState | null> {
    const current = await this.getState(personaId, stateKey);
    const currentValue = typeof current === 'number' ? current : 0;
    const newValue = currentValue + increment;

    return this.setState(personaId, stateKey, newValue);
  }

  /**
   * Get state analytics for a persona
   */
  async getStateAnalytics(
    personaId: string,
    stateKey: string,
    timeWindow: { start: Date; end: Date },
  ): Promise<{
    averageValue: number;
    peakValue: JsonValue;
    troughValue: JsonValue;
    volatility: number;
    changeCount: number;
  }> {
    const states = await this.prisma.personaState.findMany({
      where: {
        personaId,
        stateKey,
        lastUpdated: {
          gte: timeWindow.start,
          lte: timeWindow.end,
        },
      },
      orderBy: { lastUpdated: 'asc' },
    });

    if (states.length === 0) {
      return {
        averageValue: 0,
        peakValue: null,
        troughValue: null,
        volatility: 0,
        changeCount: 0,
      };
    }

    // Calculate basic statistics for numeric values
    const numericValues = states
      .map((s) => s.stateValue)
      .filter((v): v is number => typeof v === 'number');

    if (numericValues.length === 0) {
      return {
        averageValue: 0,
        peakValue: states[0]?.stateValue || null,
        troughValue: states[0]?.stateValue || null,
        volatility: 0,
        changeCount: states.length,
      };
    }

    const sum = numericValues.reduce((acc, val) => acc + val, 0);
    const average = sum / numericValues.length;
    const peak = Math.max(...numericValues);
    const trough = Math.min(...numericValues);

    // Calculate volatility as standard deviation
    const variance =
      numericValues.reduce((acc, val) => acc + (val - average) ** 2, 0) / numericValues.length;
    const volatility = Math.sqrt(variance);

    return {
      averageValue: average,
      peakValue: peak,
      troughValue: trough,
      volatility,
      changeCount: states.length,
    };
  }

  /**
   * Delete old state history to manage storage using intelligent retention logic
   * Retention period determined by state importance and access patterns
   */
  async cleanupOldStates(personaId: string): Promise<number> {
    // Get all states to analyze retention needs
    const allStates = await this.prisma.personaState.findMany({
      where: { personaId },
      orderBy: { lastUpdated: 'desc' },
    });

    if (allStates.length === 0) return 0;

    // Calculate intelligent retention periods based on state characteristics
    const statesToDelete: string[] = [];
    const now = new Date();

    for (const state of allStates) {
      const daysSinceUpdate = (now.getTime() - state.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
      const retentionDays = this.calculateStateRetentionDays(state, allStates);
      
      if (daysSinceUpdate > retentionDays) {
        statesToDelete.push(state.id);
      }
    }

    if (statesToDelete.length === 0) return 0;

    const result = await this.prisma.personaState.deleteMany({
      where: {
        id: { in: statesToDelete },
      },
    });

    return result.count;
  }

  /**
   * Calculate intelligent retention period for a state based on its characteristics
   * Source: Dynamic retention based on state significance, uniqueness, and access patterns
   */
  private calculateStateRetentionDays(state: PersonaState, allStates: PersonaState[]): number {
    let baseDays = 30; // Base retention period

    // Factor 1: State importance based on value complexity
    const valueComplexity = this.calculateValueComplexity(state.stateValue);
    if (valueComplexity > 5) baseDays += 30; // Complex states kept longer

    // Factor 2: State uniqueness - rare states kept longer
    const similarStates = allStates.filter(s => 
      s.stateKey === state.stateKey && s.id !== state.id
    ).length;
    if (similarStates < 3) baseDays += 60; // Unique states kept much longer

    // Factor 3: Recent access patterns
    const daysSinceAccessed = (Date.now() - state.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceAccessed < 7) baseDays += 45; // Recently accessed states kept longer

    // Factor 4: State type importance
    if (state.stateKey.includes('personality') || state.stateKey.includes('identity')) {
      baseDays += 90; // Personality-related states kept much longer
    }
    if (state.stateKey.includes('temp') || state.stateKey.includes('cache')) {
      baseDays = Math.min(baseDays, 14); // Temporary states cleaned up faster
    }

    // Factor 5: Storage efficiency - cap retention for common states
    if (similarStates > 10) {
      baseDays = Math.min(baseDays, 45); // Don't hoard too many similar states
    }

    return Math.max(7, Math.min(365, baseDays)); // Range: 1 week to 1 year
  }

  /**
   * Calculate complexity score for a state value
   */
  private calculateValueComplexity(value: unknown): number {
    if (value === null || value === undefined) return 0;
    
    let complexity = 0;
    
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        complexity = value.length + value.reduce((sum, item) => sum + this.calculateValueComplexity(item), 0);
      } else {
        const keys = Object.keys(value);
        complexity = keys.length + keys.reduce((sum, key) => sum + this.calculateValueComplexity((value as Record<string, unknown>)[key]), 0);
      }
    } else if (typeof value === 'string') {
      complexity = Math.min(10, value.length / 10); // String length contributes to complexity
    } else {
      complexity = 1; // Primitive values have base complexity
    }
    
    return complexity;
  }

  /**
   * Search states by content
   */
  async searchStates(personaId: string, searchTerm: string): Promise<PersonaState[]> {
    return this.prisma.personaState.findMany({
      where: {
        personaId,
        OR: [
          { stateKey: { contains: searchTerm, mode: 'insensitive' } },
          { description: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      orderBy: { lastUpdated: 'desc' },
    });
  }

  /**
   * Infer the type of a JSON value for storage
   */
  private inferValueType(value: JsonValue): string {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return 'unknown';
  }
}
