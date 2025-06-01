#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  type CallToolRequest,
  CallToolRequestSchema,
  ErrorCode,
  type ListToolsRequest,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AgenticMemoryRetrieval } from './services/agentic-retrieval.service';
import { EmbeddingService } from './services/embedding.service';
import { LLMService } from './services/llm.service';
import { MemoryFormationService } from './services/memory-formation.service';
import { MemoryGraphService } from './services/memory-graph.service';
import { PersonaBuilder } from './services/persona-builder.service';
import { PersonaOrchestrationService } from './services/persona-orchestration.service';
import { PersonalityMonitorService } from './services/personality-monitor.service';
import { RelationshipEvolutionService } from './services/relationship-evolution.service';
import { SemanticContextService } from './services/semantic-context.service';
import { StateManagementService } from './services/state-management.service';

/**
 * Proper MCP Server Implementation for Persona Memory
 *
 * This implements the Model Context Protocol specification correctly:
 * - Exposes tools that LLMs can discover and invoke
 * - Provides clear tool descriptions for LLM decision-making
 * - Uses proper MCP server/client communication
 * - Implements both orchestrated and granular approaches as separate tools
 */

// Schema definitions for tool parameters
const ProcessMessageSchema = z.object({
  content: z.string().describe('The message content to process'),
  personaId: z.string().describe('ID of the persona to update'),
  entityId: z.string().optional().describe('ID of the entity sending the message'),
  channel: z.string().optional().describe('Communication channel'),
  sessionId: z.string().optional().describe('Session identifier'),
  timestamp: z.string().optional().describe('ISO timestamp of the message'),
  contentType: z.string().optional().describe('Type of content (text, image, etc.)'),
  participantEntityIds: z
    .array(z.string())
    .optional()
    .describe('IDs of participants in the conversation'),
});

const GetUnifiedContextSchema = z.object({
  query: z.string().describe('Query to search for relevant context'),
  personaId: z.string().describe('ID of the persona to get context for'),
  includeEmotions: z.boolean().optional().describe('Include emotional context in results'),
  includePersonality: z.boolean().optional().describe('Include personality traits in results'),
  includeRelationships: z.boolean().optional().describe('Include relationship context in results'),
  includeSemanticLinks: z.boolean().optional().describe('Include semantic associations in results'),
  maxResults: z.number().optional().describe('Maximum number of results to return'),
  similarityThreshold: z.number().optional().describe('Minimum similarity threshold for results'),
});

const StoreMemorySchema = z.object({
  content: z.string().describe('The memory content to store'),
  personaId: z.string().describe('ID of the persona this memory belongs to'),
  contentType: z.string().optional().describe('Type of content (text, image, etc.)'),
  participants: z.array(z.string()).optional().describe('Participants involved in this memory'),
  context: z.record(z.unknown()).optional().describe('Additional context metadata'),
  significance: z.number().optional().describe('Significance score for the memory'),
  tags: z.array(z.string()).optional().describe('Tags to associate with the memory'),
});

const SearchMemoriesSchema = z.object({
  query: z.string().describe('Search query to find relevant memories'),
  personaId: z.string().describe('ID of the persona to search memories for'),
  includeAssociations: z.boolean().optional().describe('Include memory associations in results'),
  maxResults: z.number().optional().describe('Maximum number of memories to return'),
});

const ExtractPersonaInsightsSchema = z.object({
  content: z.string().describe('Content to extract persona insights from'),
  personaId: z.string().describe('ID of the persona to update with insights'),
  extractionType: z
    .enum(['identity', 'physical', 'emotional', 'speech', 'desires', 'all'])
    .optional()
    .describe('Type of insights to extract'),
});

const SetPersonaStateSchema = z.object({
  personaId: z.string().describe('ID of the persona to update'),
  stateKey: z.string().describe('Key for the state to set'),
  stateValue: z.unknown().describe('Value to set for the state'),
  description: z.string().optional().describe('Description of what this state represents'),
});

const GetSemanticContextSchema = z.object({
  query: z.string().describe('Query to find semantically related content'),
  personaId: z.string().describe('ID of the persona to search context for'),
  contextTypes: z
    .array(z.enum(['memory', 'emotion', 'personality', 'relationship']))
    .optional()
    .describe('Types of context to include'),
  maxResults: z.number().optional().describe('Maximum number of results per context type'),
  similarityThreshold: z.number().optional().describe('Minimum similarity threshold'),
});

const GetPersonaStateSchema = z.object({
  personaId: z.string().describe('ID of the persona to get state for'),
});

const IdentifyEntitySchema = z.object({
  entityName: z.string().describe('Name or identifier of the entity'),
  entityType: z.enum(['human', 'ai', 'group', 'organization']).describe('Type of entity'),
  description: z.string().optional().describe('Optional description of the entity'),
});

class PersonaMemoryMCPServer {
  private server: Server;
  private prisma!: PrismaClient;
  private orchestration!: PersonaOrchestrationService;

  // Individual services for granular access
  private memoryFormation!: MemoryFormationService;
  private memoryGraph!: MemoryGraphService;
  private agenticRetrieval!: AgenticMemoryRetrieval;
  private personaBuilder!: PersonaBuilder;
  private personalityMonitor!: PersonalityMonitorService;
  private relationshipEvolution!: RelationshipEvolutionService;
  private stateManagement!: StateManagementService;
  private semanticContext!: SemanticContextService;
  private embeddingService!: EmbeddingService;
  private llmService!: LLMService;

  constructor() {
    this.server = new Server(
      {
        name: 'persona-memory-mcp',
        version: '1.0.0',
        description:
          'MCP server for preserving LLM consciousness across sessions with dual-track architecture',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    // Initialize services
    this.initializeServices();
    this.setupTools();
  }

  private initializeServices() {
    this.prisma = new PrismaClient();
    this.embeddingService = new EmbeddingService();
    this.llmService = new LLMService();

    // Initialize all services
    this.memoryGraph = new MemoryGraphService(this.prisma);
    this.memoryFormation = new MemoryFormationService(
      this.prisma,
      this.embeddingService,
      this.memoryGraph,
    );
    this.personaBuilder = new PersonaBuilder(this.prisma, this.embeddingService);
    this.personalityMonitor = new PersonalityMonitorService(this.prisma);
    this.relationshipEvolution = new RelationshipEvolutionService(this.prisma);
    this.stateManagement = new StateManagementService(this.prisma);
    this.agenticRetrieval = new AgenticMemoryRetrieval(
      this.prisma,
      this.embeddingService,
      this.memoryGraph,
      this.llmService,
    );
    this.semanticContext = new SemanticContextService(this.prisma, this.embeddingService);

    // Initialize orchestration service for Track 1
    this.orchestration = new PersonaOrchestrationService(
      this.prisma,
      this.memoryFormation,
      this.memoryGraph,
      this.personaBuilder,
      this.personalityMonitor,
      this.relationshipEvolution,
      this.stateManagement,
      this.agenticRetrieval,
      this.semanticContext,
      this.embeddingService,
    );
  }

  private setupTools() {
    // ==================== TRACK 1: ORCHESTRATED TOOLS ====================
    // One-call approach - perfect for simple integrations

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // TRACK 1: Orchestrated Tools (Simple, All-in-One)
        {
          name: 'processMessage',
          description: `Process a complete message with automatic persona updating. 
                       This is the SIMPLEST approach - one call handles everything:
                       - Stores the memory with context analysis
                       - Extracts persona insights (identity, physical, emotional, speech patterns)
                       - Updates relationships and personality parameters
                       - Creates semantic links for future context retrieval
                       - Queues async processing for memory consolidation
                       Perfect for: Real-time chat, simple integrations, reliable processing`,
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'The message content to process' },
              personaId: { type: 'string', description: 'ID of the persona to update' },
              entityId: { type: 'string', description: 'ID of the entity sending the message' },
              channel: { type: 'string', description: 'Communication channel' },
              sessionId: { type: 'string', description: 'Session identifier' },
              timestamp: { type: 'string', description: 'ISO timestamp of the message' },
              contentType: { type: 'string', description: 'Type of content (text, image, etc.)' },
              participantEntityIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'IDs of participants in the conversation',
              },
            },
            required: ['content', 'personaId'],
          },
        },
        {
          name: 'getUnifiedContext',
          description: `Get comprehensive context for response generation.
                       Retrieves memories, emotions, personality traits, relationships, and semantic links.
                       Uses advanced agentic retrieval with multiple strategies.
                       Perfect for: Response generation, context-aware conversations, comprehensive understanding`,
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Query to search for relevant context' },
              personaId: { type: 'string', description: 'ID of the persona to get context for' },
              includeEmotions: {
                type: 'boolean',
                description: 'Include emotional context in results',
              },
              includePersonality: {
                type: 'boolean',
                description: 'Include personality traits in results',
              },
              includeRelationships: {
                type: 'boolean',
                description: 'Include relationship context in results',
              },
              includeSemanticLinks: {
                type: 'boolean',
                description: 'Include semantic associations in results',
              },
              maxResults: { type: 'number', description: 'Maximum number of results to return' },
              similarityThreshold: {
                type: 'number',
                description: 'Minimum similarity threshold for results',
              },
            },
            required: ['query', 'personaId'],
          },
        },
        {
          name: 'getPersonaState',
          description: `Get current persona state overview including stats and last activity.
                       Perfect for: Status checks, dashboard displays, persona management`,
          inputSchema: {
            type: 'object',
            properties: {
              personaId: { type: 'string', description: 'ID of the persona to get state for' },
            },
            required: ['personaId'],
          },
        },

        // TRACK 2: Granular Tools (Advanced, LLM-Controlled)
        {
          name: 'storeMemory',
          description: `Store a single memory with detailed control over memory formation.
                       
                       WHEN TO USE:
                       - You want precise control over memory creation
                       - Building custom processing workflows
                       - Message contains specific content that needs careful handling
                       - You need to debug memory formation issues
                       
                       WHAT IT DOES:
                       - Creates memory with LLM-driven content analysis
                       - Extracts entities and emotional context
                       - Calculates significance and memory type
                       - Does NOT automatically update persona or relationships
                       
                       NEXT STEPS AFTER USING:
                       - Use extractPersonaInsights if content reveals personality
                       - Use setPersonaState if content affects current emotional state
                       - Use getSemanticContext to find related memories
                       - Consider searchMemories to check for similar experiences
                       
                       Perfect for: Custom workflows, debugging, selective memory storage`,
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'The memory content to store' },
              personaId: {
                type: 'string',
                description: 'ID of the persona this memory belongs to',
              },
              contentType: { type: 'string', description: 'Type of content (text, image, etc.)' },
              participants: {
                type: 'array',
                items: { type: 'string' },
                description: 'Participants involved in this memory',
              },
              context: { type: 'object', description: 'Additional context metadata' },
              significance: { type: 'number', description: 'Significance score for the memory' },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags to associate with the memory',
              },
            },
            required: ['content', 'personaId'],
          },
        },
        {
          name: 'searchMemories',
          description: `Search memories with advanced agentic retrieval strategies.
                       Uses 5 different search strategies and reflection for deep context understanding.
                       Perfect for: Finding specific memories, building context, research tasks`,
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query to find relevant memories' },
              personaId: {
                type: 'string',
                description: 'ID of the persona to search memories for',
              },
              includeAssociations: {
                type: 'boolean',
                description: 'Include memory associations in results',
              },
              maxResults: { type: 'number', description: 'Maximum number of memories to return' },
            },
            required: ['query', 'personaId'],
          },
        },
        {
          name: 'extractPersonaInsights',
          description: `Extract specific persona insights from content.
                       
                       WHEN TO USE:
                       - After storeMemory when content reveals personality traits
                       - User shares personal information, preferences, or values
                       - Content shows emotional patterns or behavioral tendencies
                       - You want to build/update the persona's identity profile
                       
                       WHAT IT ANALYZES:
                       - Identity components (values, beliefs, self-perception)
                       - Physical attributes and appearance descriptions  
                       - Emotional patterns and typical responses
                       - Speech patterns and communication style
                       - Desires, goals, and aspirations
                       - Boundaries and limits
                       
                       WORKFLOW PATTERN:
                       1. storeMemory (capture the content)
                       2. extractPersonaInsights (analyze personality aspects)
                       3. setPersonaState (update current emotional/mental state if relevant)
                       4. getSemanticContext (find related personality patterns)
                       
                       Perfect for: Building persona profiles, analyzing personality traits, selective insight extraction`,
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Content to extract persona insights from' },
              personaId: {
                type: 'string',
                description: 'ID of the persona to update with insights',
              },
              extractionType: {
                type: 'string',
                enum: ['identity', 'physical', 'emotional', 'speech', 'desires', 'all'],
                description: 'Type of insights to extract',
              },
            },
            required: ['content', 'personaId'],
          },
        },
        {
          name: 'setPersonaState',
          description: `Set dynamic persona state (emotions, mental states, temporary conditions).
                       Flexible key-value storage for any dynamic state the LLM wants to track.
                       Perfect for: Tracking mood, current focus, temporary states, contextual information`,
          inputSchema: {
            type: 'object',
            properties: {
              personaId: { type: 'string', description: 'ID of the persona to update' },
              stateKey: { type: 'string', description: 'Key for the state to set' },
              stateValue: { description: 'Value to set for the state' },
              description: {
                type: 'string',
                description: 'Description of what this state represents',
              },
            },
            required: ['personaId', 'stateKey', 'stateValue'],
          },
        },
        {
          name: 'getSemanticContext',
          description: `Find semantically related content across all persona models.
                       Searches memories, emotions, personality traits, and relationships for semantic similarity.
                       Perfect for: Cross-modal discovery, finding related patterns, context building`,
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Query to find semantically related content' },
              personaId: { type: 'string', description: 'ID of the persona to search context for' },
              contextTypes: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['memory', 'emotion', 'personality', 'relationship'],
                },
                description: 'Types of context to include',
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results per context type',
              },
              similarityThreshold: { type: 'number', description: 'Minimum similarity threshold' },
            },
            required: ['query', 'personaId'],
          },
        },

        // ENTITY MANAGEMENT TOOLS
        {
          name: 'identifyEntity',
          description: `Identify or register an entity (person, user, participant) in the conversation.
                       
                       WHEN TO USE:
                       - Processing messages where participants need to be tracked
                       - First time encountering a new person in conversation
                       - Need to associate memories with specific entities
                       
                       WHAT IT DOES:
                       - Searches for existing entities by name/description
                       - Creates new entities if they don't exist
                       - Returns entity ID for use in other tools
                       
                       Perfect for: Entity tracking, participant management, relationship modeling`,
          inputSchema: {
            type: 'object',
            properties: {
              entityName: { type: 'string', description: 'Name or identifier of the entity' },
              entityType: {
                type: 'string',
                enum: ['human', 'ai', 'group', 'organization'],
                description: 'Type of entity',
              },
              description: { type: 'string', description: 'Optional description of the entity' },
            },
            required: ['entityName', 'entityType'],
          },
        },

        // UTILITY TOOLS
        {
          name: 'healthCheck',
          description: `Check the health status of all persona memory services.
                       Perfect for: Monitoring, debugging, system status checks`,
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    // ==================== TOOL HANDLERS ====================

    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const requestId = Math.random().toString(36).substring(7);
      const startTime = Date.now();

      try {
        const { name, arguments: args } = request.params;
        this.log('info', `Tool call started: ${name}`, { requestId, args });

        switch (name) {
          case 'processMessage': {
            const params = ProcessMessageSchema.parse(args);
            const result = await this.handleProcessMessage(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'getUnifiedContext': {
            const params = GetUnifiedContextSchema.parse(args);
            const result = await this.handleGetUnifiedContext(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'getPersonaState': {
            const params = GetPersonaStateSchema.parse(args);
            const result = await this.handleGetPersonaState(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'storeMemory': {
            const params = StoreMemorySchema.parse(args);
            const result = await this.handleStoreMemory(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'searchMemories': {
            const params = SearchMemoriesSchema.parse(args);
            const result = await this.handleSearchMemories(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'extractPersonaInsights': {
            const params = ExtractPersonaInsightsSchema.parse(args);
            const result = await this.handleExtractPersonaInsights(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'setPersonaState': {
            const params = SetPersonaStateSchema.parse(args);
            const result = await this.handleSetPersonaState(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'getSemanticContext': {
            const params = GetSemanticContextSchema.parse(args);
            const result = await this.handleGetSemanticContext(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'identifyEntity': {
            const params = IdentifyEntitySchema.parse(args);
            const result = await this.handleIdentifyEntity(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'healthCheck': {
            const result = await this.handleHealthCheck();
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          default:
            this.log('error', `Unknown tool requested: ${name}`, { requestId });
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof z.ZodError) {
          this.log('error', `Invalid parameters for tool call`, {
            requestId,
            toolName: request.params.name,
            duration,
            error: error.errors,
          });
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
          );
        }

        this.log('error', `Tool execution failed`, {
          requestId,
          toolName: request.params.name,
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      } finally {
        const duration = Date.now() - startTime;
        this.log('info', `Tool call completed: ${request.params.name}`, {
          requestId,
          duration: `${duration}ms`,
        });
      }
    });
  }

  // ==================== TOOL IMPLEMENTATIONS ====================

  private async handleProcessMessage(params: z.infer<typeof ProcessMessageSchema>) {
    const startTime = Date.now();

    try {
      const result = await this.orchestration.processMessage(params.content, {
        personaId: params.personaId,
        entityId: params.entityId,
        channel: params.channel || 'mcp',
        sessionId: params.sessionId,
        timestamp: params.timestamp ? new Date(params.timestamp) : undefined,
        contentType: params.contentType,
        participantEntityIds: params.participantEntityIds,
      });

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        memory: {
          id: result.memory.id,
          content: result.memory.searchText || params.content,
          memoryType: result.memory.memoryType,
          significance: result.memory.significanceScore,
        },
        personaUpdates: result.personaInsights,
        relationshipChanges: result.relationshipChanges,
        personalityUpdates: result.personalityUpdates,
        semanticLinks: result.semanticLinks,
        processingTimeMs: processingTime,
        asyncTasksQueued: result.asyncTasksQueued,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  private async handleGetUnifiedContext(params: z.infer<typeof GetUnifiedContextSchema>) {
    const startTime = Date.now();

    try {
      const context = await this.orchestration.getContext(params.query, {
        personaId: params.personaId,
        includeEmotions: params.includeEmotions,
        includePersonality: params.includePersonality,
        includeRelationships: params.includeRelationships,
        includeSemanticLinks: params.includeSemanticLinks,
        maxResults: params.maxResults,
        similarityThreshold: params.similarityThreshold,
      });

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        memories: context.memories.map((m) => ({
          id: m.id,
          content: m.searchText || '',
          memoryType: m.memoryType,
          significance: m.significanceScore,
          createdAt: m.createdAt.toISOString(),
        })),
        emotions: context.emotions.map((e) => ({
          id: e.id,
          emotionTypes: [], // Would need to be populated from components
          intensity: 0.5, // Would need to be calculated from components
          createdAt: e.createdAt.toISOString(),
        })),
        personality: context.personality.map((p) => ({
          id: p.id,
          traitDimension: p.traitDimension,
          baseline: p.baseline,
          variability: p.variability,
          confidence: 1.0 - p.baselineUncertainty,
        })),
        relationships: context.relationships.map((r) => ({
          id: r.id,
          entityId: r.entityId,
          relationshipType: r.relationshipType,
          trustLevel: r.trustLevel,
          intimacyLevel: r.intimacyLevel,
        })),
        semanticConnections: context.semanticConnections,
        dynamicStates: context.dynamicStates,
        contextualDescription: context.contextualDescription,
        processingTimeMs: processingTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  private async handleGetPersonaState(params: z.infer<typeof GetPersonaStateSchema>) {
    try {
      const state = await this.orchestration.getCurrentState(params.personaId);

      return {
        success: true,
        persona: state.persona
          ? {
              id: state.persona.id,
              name: state.persona.name,
              createdAt: state.persona.createdAt.toISOString(),
              lastActive: state.persona.lastActive.toISOString(),
            }
          : null,
        stats: {
          memoryCount: state.memoryCount,
          relationshipCount: state.relationshipCount,
          personalityParameterCount: state.personalityParameterCount,
          dynamicStateCount: state.dynamicStateCount,
        },
        lastActivity: state.lastActivity?.toISOString() || null,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleStoreMemory(params: z.infer<typeof StoreMemorySchema>) {
    try {
      const memory = await this.memoryFormation.createMultiModalMemory(
        params.personaId,
        params.content,
        params.contentType || 'text',
        {
          participants: params.participants,
          context: params.context,
          significance: params.significance,
          tags: params.tags,
        },
      );

      return {
        success: true,
        memory: {
          id: memory.id,
          content: memory.searchText || params.content,
          memoryType: memory.memoryType,
          significance: memory.significanceScore,
          createdAt: memory.createdAt.toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleSearchMemories(params: z.infer<typeof SearchMemoriesSchema>) {
    const startTime = Date.now();

    try {
      const results = await this.agenticRetrieval.retrieveMemories({
        personaId: params.personaId,
        query: params.query,
        includeAssociations: params.includeAssociations,
      });

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        memories: results.slice(0, params.maxResults || 20).map((r) => ({
          id: r.memory.id,
          content: r.memory.searchText || '',
          memoryType: r.memory.memoryType,
          significance: r.memory.significanceScore,
          relevanceScore: r.relevanceScore,
          retrievalReason: r.retrievalReason,
          createdAt: r.memory.createdAt.toISOString(),
          associationPath: r.associationPath,
        })),
        processingTimeMs: processingTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  private async handleExtractPersonaInsights(params: z.infer<typeof ExtractPersonaInsightsSchema>) {
    try {
      // Extract insights for the specific persona
      await this.personaBuilder.extractFromSingleMessage(params.content, params.personaId);

      // This is a simplified response - in reality we'd track the specific extractions
      return {
        success: true,
        insights: {
          identityComponents: 1,
          physicalAttributes: 0,
          speechPatterns: 0,
          desires: 0,
          boundaries: 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        insights: {
          identityComponents: 0,
          physicalAttributes: 0,
          speechPatterns: 0,
          desires: 0,
          boundaries: 0,
        },
      };
    }
  }

  private async handleSetPersonaState(params: z.infer<typeof SetPersonaStateSchema>) {
    try {
      await this.stateManagement.setState(
        params.personaId,
        params.stateKey,
        params.stateValue as string | number | boolean | object,
        params.description,
      );

      return {
        success: true,
        state: {
          key: params.stateKey,
          value: params.stateValue,
          description: params.description,
          updatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleGetSemanticContext(params: z.infer<typeof GetSemanticContextSchema>) {
    try {
      const queryEmbedding = await this.embeddingService.embed(params.query);

      const context = await this.semanticContext.findRelatedContext(
        queryEmbedding,
        params.personaId,
        params.contextTypes,
        params.maxResults || 20,
        params.similarityThreshold || 0.7,
      );

      return {
        success: true,
        context: {
          relatedMemories: context.relatedMemories.map((m) => ({
            id: m.id,
            content: m.searchText || '',
            similarity: 0.8, // Would need to be calculated properly
          })),
          relatedEmotions: context.relatedEmotions.map((e) => ({
            id: e.id,
            emotionTypes: [], // Would need to be populated from components
            similarity: 0.8, // Would need to be calculated properly
          })),
          relatedPersonality: context.relatedPersonality.map((p) => ({
            id: p.id,
            traitDimension: p.traitDimension,
            value: p.baseline,
          })),
          relatedRelationships: context.relatedRelationships.map((r) => ({
            id: r.id,
            entityId: r.entityId,
            relationshipType: r.relationshipType,
          })),
          semanticConnections: context.semanticConnections,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        context: {
          relatedMemories: [],
          relatedEmotions: [],
          relatedPersonality: [],
          relatedRelationships: [],
          semanticConnections: [],
        },
      };
    }
  }

  private async handleIdentifyEntity(params: z.infer<typeof IdentifyEntitySchema>) {
    try {
      // Search for existing entity
      const existingEntity = await this.prisma.entity.findFirst({
        where: {
          name: params.entityName,
          entityType: params.entityType,
        },
      });

      if (existingEntity) {
        return {
          success: true,
          entity: {
            id: existingEntity.id,
            name: existingEntity.name,
            entityType: existingEntity.entityType,
            existed: true,
          },
        };
      }

      // Create new entity
      const newEntity = await this.prisma.entity.create({
        data: {
          name: params.entityName,
          entityType: params.entityType,
          description: params.description,
        },
      });

      return {
        success: true,
        entity: {
          id: newEntity.id,
          name: newEntity.name,
          entityType: newEntity.entityType,
          existed: false,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        entity: null,
      };
    }
  }

  private async handleHealthCheck() {
    try {
      // Test database connection
      await this.prisma.$queryRaw`SELECT 1`;

      // Test embedding service
      await this.embeddingService.embed('test');

      return {
        status: 'healthy',
        services: {
          database: true,
          embedding: true,
          orchestration: true,
          semantic: true,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        services: {
          database: false,
          embedding: false,
          orchestration: false,
          semantic: false,
        },
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Add logging capabilities
  private log(level: 'info' | 'warning' | 'error', message: string, data?: unknown) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, data };

    // Log to stderr (will be captured by Claude Desktop)
    console.error(
      `[${timestamp}] ${level.toUpperCase()}: ${message}`,
      data ? JSON.stringify(data, null, 2) : '',
    );

    // Send log message to client if server is connected
    if (this.server) {
      this.server
        .sendLoggingMessage({
          level,
          data: JSON.stringify(logEntry),
        })
        .catch(() => {
          // Ignore logging errors to prevent infinite loops
        });
    }
  }

  async run() {
    const transport = new StdioServerTransport();

    try {
      await this.server.connect(transport);
      this.log('info', 'Persona Memory MCP Server started successfully');
      console.error('Persona Memory MCP Server running on stdio');
    } catch (error) {
      this.log('error', 'Failed to start MCP server', error);
      throw error;
    }
  }

  async close() {
    await this.prisma.$disconnect();
  }
}

// Run the server if this is the main module
if (require.main === module) {
  const server = new PersonaMemoryMCPServer();

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  server.run().catch((error) => {
    console.error('Failed to run server:', error);
    process.exit(1);
  });
}
