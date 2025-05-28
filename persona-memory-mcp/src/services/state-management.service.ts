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
    const where: { personaId: string; stateKey?: { in: string[] } } = { personaId };
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
    const where: { personaId: string; stateKey?: { in: string[] }; lastUpdated?: { gte: Date } } = {
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
   * Delete old state history to manage storage
   */
  async cleanupOldStates(personaId: string, keepDays = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - keepDays);

    const result = await this.prisma.personaState.deleteMany({
      where: {
        personaId,
        lastUpdated: { lt: cutoffDate },
      },
    });

    return result.count;
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
