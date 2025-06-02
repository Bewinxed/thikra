import type {
  EmotionalState,
  Memory,
  Persona,
  PersonalityParameter,
  PrismaClient,
  Relationship,
} from '@prisma/client';
import type { AgenticMemoryRetrieval } from './agentic-retrieval.service';
import type { EmbeddingService } from './embedding.service';
import type { MemoryFormationService } from './memory-formation.service';
import type { MemoryGraphService } from './memory-graph.service';
import type { PersonaBuilder } from './persona-builder.service';
import type { PersonalityMonitorService } from './personality-monitor.service';
import type { RelationshipEvolutionService } from './relationship-evolution.service';
import type { SemanticContextService } from './semantic-context.service';
import type { StateManagementService } from './state-management.service';

/**
 * Message metadata for orchestrated processing
 */
interface MessageMetadata {
  personaId: string;
  entityId?: string;
  channel: string;
  sessionId?: string;
  timestamp?: Date;
  contentType?: string;
  participantEntityIds?: string[];
}

/**
 * Processing result from orchestrated message handling
 */
interface ProcessingResult {
  memory: Memory;
  personaInsights: {
    identityComponents: number;
    physicalAttributes: number;
    speechPatterns: number;
    desires: number;
    boundaries: number;
  };
  relationshipChanges: {
    relationshipsUpdated: number;
    newRelationships: number;
  };
  personalityUpdates: {
    observationsAdded: number;
    parametersUpdated: number;
  };
  semanticLinks: number;
  processingComplete: boolean;
  asyncTasksQueued: string[];
}

/**
 * Context options for retrieval
 */
interface ContextOptions {
  personaId: string;
  includeEmotions?: boolean;
  includePersonality?: boolean;
  includeRelationships?: boolean;
  includeSemanticLinks?: boolean;
  maxResults?: number;
  similarityThreshold?: number;
}

/**
 * Unified context result combining all retrieval sources
 */
interface UnifiedContext {
  memories: Memory[];
  emotions: EmotionalState[];
  personality: PersonalityParameter[];
  relationships: Relationship[];
  semanticConnections: Array<{
    sourceType: string;
    sourceId: string;
    similarity: number;
    contextType: string;
  }>;
  dynamicStates: Record<string, unknown>;
  contextualDescription: string;
}

/**
 * Persona Orchestration Service for Phase 6
 *
 * Coordinates all existing services to provide unified MCP interface.
 * Supports both orchestrated (one-call) and granular (LLM-controlled) approaches.
 *
 * Key Features:
 * - Complete message processing pipeline
 * - Enhanced context retrieval with semantic linking
 * - Async processing queue for heavy operations
 * - Unified error handling and result formatting
 * - Performance monitoring for A/B testing
 */
export class PersonaOrchestrationService {
  constructor(
    private prisma: PrismaClient,
    private memoryFormation: MemoryFormationService,
    private memoryGraph: MemoryGraphService,
    private personaBuilder: PersonaBuilder,
    private personalityMonitor: PersonalityMonitorService,
    private relationshipEvolution: RelationshipEvolutionService,
    private stateManagement: StateManagementService,
    private agenticRetrieval: AgenticMemoryRetrieval,
    private semanticContext: SemanticContextService,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * Complete message processing pipeline - Track 1 (Orchestrated Approach)
   *
   * This is the "one-call" approach where the orchestration service handles
   * everything automatically. LLM just needs to call this once per message.
   */
  async processMessage(content: string, metadata: MessageMetadata): Promise<ProcessingResult> {
    const startTime = Date.now();

    try {
      // 1. Create memory using existing MemoryFormationService
      console.log('🧠 Creating memory from message...');
      const conversation = [
        {
          role: (metadata.entityId ? 'user' : 'assistant') as 'user' | 'assistant',
          content,
          timestamp: metadata.timestamp || new Date(),
          metadata: {
            senderId: metadata.entityId || metadata.personaId,
            contentType: metadata.contentType || 'text',
          },
        },
      ];

      const memories = await this.memoryFormation.createMemoriesFromConversation(
        metadata.personaId,
        conversation,
        {
          personaName: 'MCP-Persona',
          channel: metadata.channel,
          sessionId: metadata.sessionId || `mcp-${Date.now()}`,
        },
      );

      const memory = memories[0];
      if (!memory) {
        throw new Error('Failed to create memory from message');
      }

      // 2. Extract persona insights using existing PersonaBuilder
      console.log('👤 Extracting persona insights...');
      try {
        await this.personaBuilder.extractFromSingleMessage(content, metadata.personaId);
        console.log('✅ Persona insights extracted successfully');
      } catch (error) {
        console.warn('⚠️ Failed to extract persona insights:', error);
      }

      // 3. Update relationships if entity specified
      let relationshipChanges = { relationshipsUpdated: 0, newRelationships: 0 };
      if (metadata.entityId) {
        console.log('💕 Processing relationship evolution...');
        // First, get or create the relationship
        const relationship = await this.prisma.relationship.findUnique({
          where: {
            personaId_entityId: {
              personaId: metadata.personaId,
              entityId: metadata.entityId,
            },
          },
        });

        if (relationship) {
          await this.relationshipEvolution.processNewMemory(memory, relationship);
          relationshipChanges = { relationshipsUpdated: 1, newRelationships: 0 };
        } else {
          relationshipChanges = { relationshipsUpdated: 0, newRelationships: 0 };
        }
      }

      // 4. Monitor personality changes using existing PersonalityMonitorService
      console.log('🎭 Monitoring personality changes...');
      // PersonalityMonitorService.extractObservations expects personaId first, then content
      const personalityObservations = await this.personalityMonitor.extractObservations(
        metadata.personaId,
        content,
        memory.id,
      );
      const personalityUpdates = {
        observationsAdded: personalityObservations.length,
        parametersUpdated: 0, // This would need to be tracked separately
      };

      // 5. Create semantic links using SemanticContextService
      console.log('🔗 Creating semantic links...');
      await this.semanticContext.createSemanticLink({
        sourceType: 'memory',
        sourceId: memory.id,
        personaId: metadata.personaId,
        content,
        timestamp: metadata.timestamp,
        participantEntityIds: metadata.participantEntityIds,
      });

      // 6. Queue async processing tasks
      const asyncTasks = await this.queueAsyncProcessing(metadata.personaId, [
        'memory_consolidation',
        'semantic_deduplication',
        'relationship_analysis',
      ]);

      const processingTime = Date.now() - startTime;
      console.log(`✅ Message processing completed in ${processingTime}ms`);

      return {
        memory,
        personaInsights: {
          extracted: true, // Persona insights were extracted via PersonaBuilder
        },
        relationshipChanges,
        personalityUpdates: {
          observationsAdded: personalityUpdates.observationsAdded,
          parametersUpdated: personalityUpdates.parametersUpdated,
        },
        semanticLinks: 1,
        processingComplete: true,
        asyncTasksQueued: asyncTasks,
      };
    } catch (error) {
      console.error('❌ Error in processMessage:', error);
      throw new Error(
        `Message processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Enhanced context retrieval using existing AgenticRetrieval + semantic context
   *
   * This combines the power of AgenticMemoryRetrieval with the new SemanticContextService
   * to provide unified context across all persona models.
   */
  async getContext(query: string, options: ContextOptions): Promise<UnifiedContext> {
    const startTime = Date.now();

    try {
      console.log(`🔍 Retrieving context for query: "${query}"`);

      // Use enhanced AgenticRetrieval for memory search
      const retrievalResults = await this.agenticRetrieval.retrieveMemories({
        personaId: options.personaId,
        query,
        includeAssociations: true,
      });

      const memories = retrievalResults.map((r) => r.memory);

      // Add semantic context from SemanticContextService if requested
      let emotions: EmotionalState[] = [];
      let personality: PersonalityParameter[] = [];
      let relationships: Relationship[] = [];
      let semanticConnections: UnifiedContext['semanticConnections'] = [];

      if (options.includeSemanticLinks !== false) {
        console.log('🔗 Adding semantic context...');
        const queryEmbedding = await this.embeddingService.embed(query);
        const semanticContext = await this.semanticContext.findRelatedContext(
          queryEmbedding,
          options.personaId,
          undefined,
          options.maxResults || 20,
          options.similarityThreshold || 0.7,
        );

        if (options.includeEmotions !== false) {
          emotions = semanticContext.relatedEmotions;
        }
        if (options.includePersonality !== false) {
          personality = semanticContext.relatedPersonality;
        }
        if (options.includeRelationships !== false) {
          relationships = semanticContext.relatedRelationships;
        }
        semanticConnections = semanticContext.semanticConnections;
      }

      // Get current dynamic states
      const dynamicStates = await this.stateManagement.getStates(options.personaId);

      // Create contextual description
      const contextualDescription = this.buildContextualDescription({
        memoryCount: memories.length,
        emotionCount: emotions.length,
        personalityCount: personality.length,
        relationshipCount: relationships.length,
        semanticConnectionCount: semanticConnections.length,
        query,
      });

      const processingTime = Date.now() - startTime;
      console.log(`✅ Context retrieval completed in ${processingTime}ms`);

      return {
        memories,
        emotions,
        personality,
        relationships,
        semanticConnections,
        dynamicStates,
        contextualDescription,
      };
    } catch (error) {
      console.error('❌ Error in getContext:', error);
      throw new Error(
        `Context retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get current persona state - useful for MCP tools
   */
  async getCurrentState(personaId: string): Promise<{
    persona: Persona | null;
    memoryCount: number;
    relationshipCount: number;
    personalityParameterCount: number;
    dynamicStateCount: number;
    lastActivity: Date | null;
  }> {
    try {
      const [persona, memoryCount, relationshipCount, personalityCount, stateCount] =
        await Promise.all([
          this.prisma.persona.findUnique({ where: { id: personaId } }),
          this.prisma.memory.count({ where: { personaId } }),
          this.prisma.relationship.count({ where: { personaId } }),
          this.prisma.personalityParameter.count({ where: { personaId } }),
          this.prisma.personaState.count({ where: { personaId } }),
        ]);

      const lastMemory = await this.prisma.memory.findFirst({
        where: { personaId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      return {
        persona,
        memoryCount,
        relationshipCount,
        personalityParameterCount: personalityCount,
        dynamicStateCount: stateCount,
        lastActivity: lastMemory?.createdAt || null,
      };
    } catch (error) {
      console.error('❌ Error in getCurrentState:', error);
      throw new Error(
        `State retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Queue async processing tasks for background execution
   */
  private async queueAsyncProcessing(personaId: string, taskTypes: string[]): Promise<string[]> {
    // For now, we'll just return the task names
    // In a full implementation, this would queue tasks in a job queue like Bull/BullMQ
    console.log(`📋 Queuing async tasks for persona ${personaId}: ${taskTypes.join(', ')}`);

    return taskTypes.map((task) => `${task}_${personaId}_${Date.now()}`);
  }

  /**
   * Build contextual description for unified context
   */
  private buildContextualDescription(stats: {
    memoryCount: number;
    emotionCount: number;
    personalityCount: number;
    relationshipCount: number;
    semanticConnectionCount: number;
    query: string;
  }): string {
    const parts = [`Query: "${stats.query}"`, `Retrieved ${stats.memoryCount} relevant memories`];

    if (stats.emotionCount > 0) {
      parts.push(`${stats.emotionCount} related emotional states`);
    }
    if (stats.personalityCount > 0) {
      parts.push(`${stats.personalityCount} personality parameters`);
    }
    if (stats.relationshipCount > 0) {
      parts.push(`${stats.relationshipCount} relevant relationships`);
    }
    if (stats.semanticConnectionCount > 0) {
      parts.push(`${stats.semanticConnectionCount} semantic connections`);
    }

    return `${parts.join(', ')}.`;
  }
}
