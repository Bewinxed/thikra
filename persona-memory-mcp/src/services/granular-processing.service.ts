import type { PrismaClient } from '@prisma/client';
import { b } from '../../baml_client';
import type {
  ActionResult,
  GranularContext,
  GranularEvaluation,
  GranularPlan,
  NextActionDecision,
  ToolAction,
} from '../../baml_client/types';
import type { AgenticMemoryRetrieval } from './agentic-retrieval.service';
import type { EmbeddingService } from './embedding.service';
import type { MemoryFormationService } from './memory-formation.service';
import type { PersonaBuilder } from './persona-builder.service';
import type { SemanticContextService } from './semantic-context.service';
import type { StateManagementService } from './state-management.service';

/**
 * Granular Processing Service
 *
 * Implements the LLM-driven approach where the AI decides which tools to use
 * and in what sequence, based on message content and context.
 *
 * This is Track 2 from the recommendations - letting the LLM be intelligent
 * about tool usage rather than hardcoding orchestration logic.
 */
export class GranularProcessingService {
  constructor(
    private prisma: PrismaClient,
    private memoryFormation: MemoryFormationService,
    private personaBuilder: PersonaBuilder,
    private stateManagement: StateManagementService,
    private agenticRetrieval: AgenticMemoryRetrieval,
    private semanticContext: SemanticContextService,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * Process a message using the granular approach
   *
   * The LLM decides which tools to use and in what sequence
   */
  async processMessage(
    content: string,
    personaId: string,
    options: {
      entityId?: string;
      channel?: string;
      sessionId?: string;
      timestamp?: Date;
      contentType?: string;
    } = {},
  ): Promise<{
    plan: GranularPlan;
    results: ActionResult[];
    evaluation: GranularEvaluation;
    totalDuration: number;
  }> {
    const startTime = Date.now();

    // 1. Build context for planning
    const context = await this.buildGranularContext(personaId, content);

    // 2. Create initial plan using LLM
    console.log('🧠 Planning granular processing approach...');
    const plan = await b.PlanGranularProcessing(content, context);

    console.log(
      `📋 Plan created: ${plan.plannedActions.length} actions, estimated ${plan.estimatedTime}ms`,
    );
    console.log(`🎯 Strategy: ${plan.strategy}`);

    // 3. Execute the plan adaptively
    const results = await this.executePlanAdaptively(plan, content, personaId, options);

    // 4. Evaluate the results
    const totalDuration = Date.now() - startTime;
    const evaluation = await b.EvaluateGranularResults(results, content, totalDuration);

    console.log(`✅ Granular processing completed in ${totalDuration}ms`);
    console.log(`📊 Overall rating: ${evaluation.overallRating}/1.0`);

    return {
      plan,
      results,
      evaluation,
      totalDuration,
    };
  }

  /**
   * Build context for granular planning
   */
  private async buildGranularContext(personaId: string, content: string): Promise<GranularContext> {
    // Check if persona has memories
    const memoryCount = await this.prisma.memory.count({
      where: { personaId },
    });
    const hasMemories = memoryCount > 0;

    // Get recent emotional state
    const recentState = await this.stateManagement.getState(personaId, 'emotional_state');
    const recentEmotionalState = (recentState?.value as string) || 'neutral';

    // Get known entities (simplified for now)
    const entities = await this.prisma.entity.findMany({
      take: 10,
      select: { id: true, name: true, entityType: true },
    });
    const knownEntities = entities.map((e) => e.name || e.entityType).filter(Boolean);

    // Assess content complexity
    const complexity = this.assessContentComplexity(content);

    return {
      personaId,
      hasMemories,
      recentEmotionalState,
      knownEntities,
      complexity,
    };
  }

  /**
   * Execute the plan adaptively, allowing the LLM to modify as it goes
   */
  private async executePlanAdaptively(
    plan: GranularPlan,
    content: string,
    personaId: string,
    options: {
      entityId?: string;
      channel?: string;
      sessionId?: string;
      timestamp?: Date;
      contentType?: string;
    },
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const completedActions: string[] = [];
    const currentPlan = plan;

    for (let i = 0; i < currentPlan.plannedActions.length; i++) {
      const action = currentPlan.plannedActions[i];

      console.log(`🔧 Executing: ${action.tool} (${action.priority})`);
      console.log(`💭 Reasoning: ${action.reasoning}`);

      // Execute the action
      const actionStart = Date.now();
      const result = await this.executeAction(action, content, personaId, options);
      const actionDuration = Date.now() - actionStart;

      result.duration = actionDuration;
      results.push(result);
      completedActions.push(action.tool);

      // After each action, let the LLM decide what to do next
      if (i < currentPlan.plannedActions.length - 1) {
        const decision = await b.DecideNextAction(currentPlan, completedActions, results);

        if (decision.decision === 'complete') {
          console.log(`🏁 LLM decided to complete processing early: ${decision.reasoning}`);
          break;
        }
        if (decision.decision === 'adapt' && decision.newAction) {
          console.log(`🔄 LLM adapted plan: ${decision.reasoning}`);
          // Insert the new action
          currentPlan.plannedActions.splice(i + 1, 0, decision.newAction);
        } else if (decision.decision === 'skip' && decision.actionsToSkip.length > 0) {
          console.log(`⏭️ LLM decided to skip actions: ${decision.actionsToSkip.join(', ')}`);
          // Remove skipped actions
          currentPlan.plannedActions = currentPlan.plannedActions.filter(
            (a, idx) => idx <= i || !decision.actionsToSkip.includes(a.tool),
          );
        }
      }
    }

    return results;
  }

  /**
   * Execute a single tool action
   */
  private async executeAction(
    action: ToolAction,
    content: string,
    personaId: string,
    options: {
      entityId?: string;
      channel?: string;
      sessionId?: string;
      timestamp?: Date;
      contentType?: string;
    },
  ): Promise<ActionResult> {
    const insights: string[] = [];
    const errors: string[] = [];
    let success = false;
    let dataChanged = false;

    try {
      switch (action.tool) {
        case 'storeMemory': {
          const memory = await this.memoryFormation.createMemoriesFromConversation(
            personaId,
            [{ role: 'user', content, timestamp: options.timestamp }],
            {
              personaName: 'Granular-Persona',
              channel: options.channel || 'granular',
              sessionId: options.sessionId || `granular-${Date.now()}`,
            },
          );
          success = memory.length > 0;
          dataChanged = success;
          insights.push(
            `Created ${memory.length} memories with significance ${memory[0]?.significanceScore || 'unknown'}`,
          );
          break;
        }

        case 'extractPersonaInsights':
          await this.personaBuilder.extractFromSingleMessage(content, personaId);
          success = true;
          dataChanged = true;
          insights.push('Extracted persona insights from message');
          break;

        case 'searchMemories': {
          const query = action.parameters.query || content.substring(0, 100);
          const searchResults = await this.agenticRetrieval.retrieveMemories({
            personaId,
            query,
            includeAssociations: true,
          });
          success = true;
          insights.push(`Found ${searchResults.length} relevant memories`);
          break;
        }

        case 'setPersonaState':
          if (action.parameters.stateKey && action.parameters.stateValue) {
            await this.stateManagement.setState(
              personaId,
              action.parameters.stateKey,
              action.parameters.stateValue,
              'Granular processing update',
            );
            success = true;
            dataChanged = true;
            insights.push(
              `Updated state: ${action.parameters.stateKey} = ${action.parameters.stateValue}`,
            );
          } else {
            errors.push('Missing stateKey or stateValue for setPersonaState');
          }
          break;

        case 'getSemanticContext': {
          const embedding = await this.embeddingService.embed(content);
          const semanticResults = await this.semanticContext.findRelatedContext(
            embedding,
            personaId,
            undefined,
            action.parameters.maxResults || 10,
            0.7,
          );
          success = true;
          insights.push(
            `Found semantic connections: ${semanticResults.semanticConnections.length} links`,
          );
          break;
        }

        default:
          errors.push(`Unknown tool: ${action.tool}`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    return {
      tool: action.tool,
      success,
      duration: 0, // Will be set by caller
      dataChanged,
      insights,
      errors,
    };
  }

  /**
   * Assess content complexity for planning
   */
  private assessContentComplexity(content: string): string {
    const length = content.length;
    const words = content.split(/\s+/).length;
    const sentences = content.split(/[.!?]+/).length;

    if (words < 5) return 'trivial';
    if (words < 20) return 'simple';
    if (words < 50) return 'moderate';
    if (words < 100) return 'complex';
    return 'elaborate';
  }
}
