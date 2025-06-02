#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { b } from '../baml_client';
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
  entityType: z.enum(['human', 'llm', 'system', 'unknown']).describe('Type of entity'),
  description: z.string().optional().describe('Optional description of the entity'),
});


const StoreSimpleMemorySchema = z.object({
  content: z.string().describe('The simple message content to store'),
  personaId: z.string().describe('ID of the persona'),
  entityId: z.string().optional().describe('ID of the entity sending the message'),
  channel: z.string().optional().describe('Communication channel'),
  sessionId: z.string().optional().describe('Session identifier'),
});

const StoreSignificantMemorySchema = z.object({
  content: z.string().describe('The significant message content to store'),
  personaId: z.string().describe('ID of the persona'),
  entityId: z.string().optional().describe('ID of the entity sending the message'),
  channel: z.string().optional().describe('Communication channel'),
  sessionId: z.string().optional().describe('Session identifier'),
  significance: z.number().optional().describe('Override significance score (0.0-1.0)'),
});

const ExtractEmotionalInsightsSchema = z.object({
  content: z.string().describe('Content containing emotional information'),
  personaId: z.string().describe('ID of the persona to update'),
  memoryId: z.string().describe('ID of the memory this relates to'),
});

const DetectRelationshipShiftSchema = z.object({
  content: z.string().describe('Content to analyze for relationship indicators'),
  personaId: z.string().describe('ID of the persona'),
  entityId: z.string().describe('ID of the other entity in the relationship'),
  memoryId: z.string().describe('ID of the memory this relates to'),
});

const UpdateEmotionalBondSchema = z.object({
  personaId: z.string().describe('ID of the persona'),
  entityId: z.string().describe('ID of the other entity'),
  trustChange: z.number().describe('Change in trust level (-1.0 to 1.0)'),
  intimacyChange: z.number().describe('Change in intimacy level (-1.0 to 1.0)'),
  reason: z.string().describe('Reason for the bond change'),
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
        // All-in-one message processing
        // {
        //   name: 'processMessage',
        //   description: `Processes a message completely in one operation. Stores memory, extracts persona insights, updates relationships and personality parameters, and creates semantic links.`,
        //   inputSchema: {
        //     type: 'object',
        //     properties: {
        //       content: { type: 'string', description: 'The message content to process' },
        //       personaId: { type: 'string', description: 'ID of the persona to update' },
        //       entityId: { type: 'string', description: 'ID of the entity sending the message' },
        //       channel: { type: 'string', description: 'Communication channel' },
        //       sessionId: { type: 'string', description: 'Session identifier' },
        //       timestamp: { type: 'string', description: 'ISO timestamp of the message' },
        //       contentType: { type: 'string', description: 'Type of content (text, image, etc.)' },
        //       participantEntityIds: {
        //         type: 'array',
        //         items: { type: 'string' },
        //         description: 'IDs of participants in the conversation',
        //       },
        //     },
        //     required: ['content', 'personaId'],
        //   },
        // },
        {
          name: 'getUnifiedContext',
          description: `Retrieves comprehensive context including memories, emotions, personality traits, relationships, and semantic links. Uses multi-strategy retrieval with reflection.`,
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
          description: `Returns current persona state overview including stats and last activity.`,
          inputSchema: {
            type: 'object',
            properties: {
              personaId: { type: 'string', description: 'ID of the persona to get state for' },
            },
            required: ['personaId'],
          },
        },

        {
          name: 'storeMemory',
          description: `Store memory with automatic significance analysis. Chooses processing depth based on content importance.
                       
                       Use when unsure about content significance - it automatically decides between fast/comprehensive processing.
                       For better performance control, prefer storeSimpleMemory (fast) or storeSignificantMemory (comprehensive).`,
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
              significance: { type: 'number', description: 'Override significance score (0.0-1.0)' },
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
          name: 'storeSimpleMemory',
          description: `Fast memory storage (~2-3s) for routine content like greetings, confirmations, acknowledgments.
                       
                       Skips persona analysis and relationship processing for maximum efficiency.
                       Use for: Brief exchanges, status updates, simple confirmations, casual chatter.`,
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'The simple message content to store' },
              personaId: { type: 'string', description: 'ID of the persona' },
              entityId: { type: 'string', description: 'ID of the entity sending the message' },
              channel: { type: 'string', description: 'Communication channel' },
              sessionId: { type: 'string', description: 'Session identifier' },
            },
            required: ['content', 'personaId'],
          },
        },
        {
          name: 'storeSignificantMemory',
          description: `Comprehensive memory storage (~10-15s) for meaningful content that reveals personality or emotions.
                       
                       Includes full persona analysis, relationship processing, and semantic linking.
                       Use for: Personal revelations, emotional content, relationship changes, important decisions.`,
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'The significant message content to store' },
              personaId: { type: 'string', description: 'ID of the persona' },
              entityId: { type: 'string', description: 'ID of the entity sending the message' },
              channel: { type: 'string', description: 'Communication channel' },
              sessionId: { type: 'string', description: 'Session identifier' },
              significance: {
                type: 'number',
                description: 'Override significance score (0.0-1.0)',
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
          description: `Extract detailed persona insights from content when you need granular control over what gets analyzed.
                       
                       Use this when storeMemory isn't sufficient or you want to analyze existing content differently.
                       Extracts identity, physical, emotional, speech patterns, desires, and boundaries.`,
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
          description: `Sets ephemeral/temporary persona states like current mood, focus, or conversation context. NOT for personality traits or permanent attributes - use extractPersonaInsights for those.`,
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

        // STEP 3A: EMOTIONAL PROCESSING (For Vulnerable/Emotional Content)
        {
          name: 'extractEmotionalInsights',
          description: `Extract deep emotional patterns and vulnerability markers from meaningful content.
                       
                       Specializes in discovering vulnerability thresholds, emotional guardedness patterns, trust formation dynamics, and anxiety manifestations. 
                       Identifies how easily someone opens up, their protective behaviors, and stress response mechanisms.
                       
                       Particularly effective for content revealing personal struggles, relationship feelings, mental health patterns, or emotional reactions.
                       Returns discovered emotional traits with confidence scores and supporting evidence.`,
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Content containing emotional information' },
              personaId: { type: 'string', description: 'ID of the persona to update' },
              memoryId: { type: 'string', description: 'ID of the memory this relates to' },
            },
            required: ['content', 'personaId', 'memoryId'],
          },
        },
        {
          name: 'detectRelationshipShift',
          description: `Analyze content for indicators of changing relationship dynamics and emotional connections.
                       
                       Detects trust level changes, intimacy shifts, emotional bond evolution, and communication comfort adjustments.
                       Identifies expressions of feeling safe, different levels of vulnerability sharing, and relationship comfort changes.
                       
                       Returns detected relationship changes with confidence scores, specific indicators found, and reasoning for the assessment.`,
          inputSchema: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'Content to analyze for relationship indicators',
              },
              personaId: { type: 'string', description: 'ID of the persona' },
              entityId: {
                type: 'string',
                description: 'ID of the other entity in the relationship',
              },
              memoryId: { type: 'string', description: 'ID of the memory this relates to' },
            },
            required: ['content', 'personaId', 'entityId', 'memoryId'],
          },
        },
        {
          name: 'updateEmotionalBond',
          description: `Apply detected relationship changes to update trust and intimacy levels between entities.
                       
                       Updates trust levels, intimacy progression, emotional safety parameters, and communication openness based on relationship evolution.
                       Uses PAD emotional model integration with PersDyn personality dynamics and Gottman relationship research.
                       
                       Requires trust and intimacy change values (-1.0 to 1.0) with reasoning for the bond modification.`,
          inputSchema: {
            type: 'object',
            properties: {
              personaId: { type: 'string', description: 'ID of the persona' },
              entityId: { type: 'string', description: 'ID of the other entity' },
              trustChange: { type: 'number', description: 'Change in trust level (-1.0 to 1.0)' },
              intimacyChange: {
                type: 'number',
                description: 'Change in intimacy level (-1.0 to 1.0)',
              },
              reason: { type: 'string', description: 'Reason for the bond change' },
            },
            required: ['personaId', 'entityId', 'trustChange', 'intimacyChange', 'reason'],
          },
        },

        // ENTITY MANAGEMENT TOOLS
        {
          name: 'identifyEntity',
          description: `Register or locate conversation participants for accurate memory association and relationship tracking.
                       
                       Searches for existing entities by name and type, creates new entity records when needed.
                       Essential for associating memories with specific participants and enabling relationship modeling.
                       
                       Returns entity ID for use in memory storage and relationship operations.`,
          inputSchema: {
            type: 'object',
            properties: {
              entityName: { type: 'string', description: 'Name or identifier of the entity' },
              entityType: {
                type: 'string',
                enum: ['human', 'llm', 'system', 'unknown'],
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

          case 'storeSimpleMemory': {
            const params = StoreSimpleMemorySchema.parse(args);
            const result = await this.handleStoreSimpleMemory(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'storeSignificantMemory': {
            const params = StoreSignificantMemorySchema.parse(args);
            const result = await this.handleStoreSignificantMemory(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'extractEmotionalInsights': {
            const params = ExtractEmotionalInsightsSchema.parse(args);
            const result = await this.handleExtractEmotionalInsights(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'detectRelationshipShift': {
            const params = DetectRelationshipShiftSchema.parse(args);
            const result = await this.handleDetectRelationshipShift(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'updateEmotionalBond': {
            const params = UpdateEmotionalBondSchema.parse(args);
            const result = await this.handleUpdateEmotionalBond(params);
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
          this.log('error', 'Invalid parameters for tool call', {
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

        this.log('error', 'Tool execution failed', {
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
    const startTime = Date.now();
    
    try {
      // Step 1: Store the memory
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

      // Step 2: Extract persona insights automatically if significance is high enough
      let personaInsights = null;
      if (memory.significanceScore > 0.3) {
        try {
          const existingPersona = await this.personaBuilder.getExistingPersonaContext(params.personaId);
          const extraction = await this.personaBuilder.contextAwareMultiPassExtraction(
            params.content, 
            existingPersona
          );
          await this.personaBuilder.saveExtractionResults(params.personaId, extraction);
          
          personaInsights = {
            identityCount: extraction.identityComponents.length,
            physicalCount: extraction.physicalAttributes.length,
            speechCount: extraction.speechPatterns.length,
            desireCount: extraction.desires.length,
            boundaryCount: extraction.boundaries.length,
            traitCount: extraction.personalityTraits.length,
            preferenceCount: extraction.preferences.length,
          };
        } catch (error) {
          console.warn('Persona extraction failed during storeMemory:', error);
        }
      }

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        memory: {
          id: memory.id,
          content: memory.searchText || params.content,
          memoryType: memory.memoryType,
          significance: memory.significanceScore,
          createdAt: memory.createdAt.toISOString(),
        },
        personaUpdates: personaInsights,
        processingTimeMs: processingTime,
        workflow: 'comprehensive', // Indicate this did full processing
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs: Date.now() - startTime,
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
      // Get existing persona context to avoid redundant analysis
      const existingPersona = await this.personaBuilder.getExistingPersonaContext(params.personaId);
      
      // Extract insights and get the actual results
      const extraction = await this.personaBuilder.contextAwareMultiPassExtraction(
        params.content, 
        existingPersona
      );
      
      // Save to database
      await this.personaBuilder.saveExtractionResults(params.personaId, extraction);

      // Return the actual extracted data
      return {
        success: true,
        insights: {
          identityComponents: extraction.identityComponents,
          physicalAttributes: extraction.physicalAttributes,
          speechPatterns: extraction.speechPatterns,
          desires: extraction.desires,
          boundaries: extraction.boundaries,
          personalityTraits: extraction.personalityTraits,
          preferences: extraction.preferences,
        },
        summary: {
          identityCount: extraction.identityComponents.length,
          physicalCount: extraction.physicalAttributes.length,
          speechCount: extraction.speechPatterns.length,
          desireCount: extraction.desires.length,
          boundaryCount: extraction.boundaries.length,
          traitCount: extraction.personalityTraits.length,
          preferenceCount: extraction.preferences.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        insights: null,
        summary: null,
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

  private async handleAnalyzeContent(params: z.infer<typeof AnalyzeContentSchema>) {
    try {
      // Use existing BAML functions to analyze content
      const [meaningfulness, significance, emotionAnalysis] = await Promise.all([
        b.CheckContentMeaningfulness(params.content),
        b.AssessContentSignificance(
          params.content,
          'user',
          JSON.stringify({ personaId: params.personaId }),
        ),
        // Use AnalyzeEmotions instead of CheckEmotionalContent to eliminate redundancy
        b.AnalyzeEmotions(params.content),
      ]);

      const analysisResult = {
        success: true,
        analysis: {
          significance: significance.significanceScore,
          emotionalWeight: significance.emotionalWeight,
          personalRelevance: significance.personalRelevance,
          isEmotional:
            emotionAnalysis.primaryEmotions.length > 0 ||
            emotionAnalysis.secondaryEmotions.length > 0,
          meaningfulness: meaningfulness.isMeaningful,
          factors: significance.factors,
        },
        recommendations: {
          processingApproach: significance.significanceScore < 0.3 ? 'simple' : 'comprehensive',
          suggestedTools: this.generateToolRecommendations(significance, {
            hasEmotionalContent:
              emotionAnalysis.primaryEmotions.length > 0 ||
              emotionAnalysis.secondaryEmotions.length > 0,
          }),
          estimatedTime: significance.significanceScore < 0.3 ? '2-3s' : '10-15s',
          priority:
            significance.significanceScore > 0.7
              ? 'high'
              : significance.significanceScore > 0.3
                ? 'medium'
                : 'low',
        },
      };

      return analysisResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        analysis: {
          significance: 0.5,
          emotionalWeight: 0.0,
          personalRelevance: 0.0,
          isEmotional: false,
          meaningfulness: true,
          factors: ['Analysis failed - defaulting to medium significance'],
        },
        recommendations: {
          processingApproach: 'comprehensive',
          suggestedTools: ['storeMemory'],
          estimatedTime: '10-15s',
          priority: 'medium',
        },
      };
    }
  }

  private generateToolRecommendations(significance: any, emotional: any): string[] {
    const tools: string[] = [];

    // Primary recommendation is always storeMemory since it now does comprehensive processing
    tools.push('storeMemory');

    // Only suggest specialized tools for specific analysis needs
    if (emotional.hasEmotionalContent && significance.significanceScore > 0.7) {
      tools.push('extractEmotionalInsights');
    }

    if (significance.significanceScore > 0.7 && emotional.hasEmotionalContent) {
      tools.push('detectRelationshipShift');
    }

    return tools;
  }

  private async handleStoreSimpleMemory(params: z.infer<typeof StoreSimpleMemorySchema>) {
    try {
      // Create a simple memory without full processing
      const memory = await this.memoryFormation.createMultiModalMemory(
        params.personaId,
        params.content,
        'text',
        {
          significance: 0.2, // Force low significance
          skipEntityExtraction: true,
          skipEmotionalAnalysis: true,
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
        processingApproach: 'simple',
        skippedAnalysis: ['persona', 'relationship', 'personality', 'emotional'],
        message: 'Content stored with minimal processing for efficiency',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingApproach: 'simple',
      };
    }
  }

  private async handleStoreSignificantMemory(params: z.infer<typeof StoreSignificantMemorySchema>) {
    try {
      // Create memory with full analysis
      const memory = await this.memoryFormation.createMultiModalMemory(
        params.personaId,
        params.content,
        'text',
        {
          significance: params.significance,
          channel: params.channel,
          sessionId: params.sessionId,
        },
      );

      // Automatically do persona extraction for significant memories
      let personaInsights = null;
      try {
        const existingPersona = await this.personaBuilder.getExistingPersonaContext(params.personaId);
        const extraction = await this.personaBuilder.contextAwareMultiPassExtraction(
          params.content, 
          existingPersona
        );
        await this.personaBuilder.saveExtractionResults(params.personaId, extraction);
        
        personaInsights = {
          identityCount: extraction.identityComponents.length,
          physicalCount: extraction.physicalAttributes.length,
          speechCount: extraction.speechPatterns.length,
          desireCount: extraction.desires.length,
          boundaryCount: extraction.boundaries.length,
          traitCount: extraction.personalityTraits.length,
          preferenceCount: extraction.preferences.length,
        };
      } catch (error) {
        console.warn('Persona extraction failed during storeSignificantMemory:', error);
      }

      return {
        success: true,
        memory: {
          id: memory.id,
          content: memory.searchText || params.content,
          memoryType: memory.memoryType,
          significance: memory.significanceScore,
          createdAt: memory.createdAt.toISOString(),
        },
        personaUpdates: personaInsights,
        processingApproach: 'comprehensive',
        workflow: 'comprehensive with persona extraction',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingApproach: 'comprehensive',
      };
    }
  }

  private async handleExtractEmotionalInsights(
    params: z.infer<typeof ExtractEmotionalInsightsSchema>,
  ) {
    try {
      // Use PersonalityMonitorService to extract emotional observations
      const observations = await this.personalityMonitor.extractObservations(
        params.personaId,
        params.content,
        params.memoryId,
      );

      // Filter for emotional/vulnerability related observations
      const emotionalObservations = observations.filter(
        (obs) =>
          obs.traitDimension.includes('vulnerability') ||
          obs.traitDimension.includes('emotional') ||
          obs.traitDimension.includes('anxiety') ||
          obs.traitDimension.includes('trust'),
      );

      return {
        success: true,
        insights: {
          emotionalObservations: emotionalObservations.length,
          totalObservations: observations.length,
          discoveredTraits: emotionalObservations.map((obs) => ({
            traitDimension: obs.traitDimension,
            observedValue: obs.observedValue,
            confidence: obs.confidence,
            situation: obs.situation,
          })),
        },
        specializations: {
          vulnerabilityPatterns: emotionalObservations.filter((obs) =>
            obs.traitDimension.includes('vulnerability'),
          ).length,
          trustPatterns: emotionalObservations.filter((obs) => obs.traitDimension.includes('trust'))
            .length,
          anxietyPatterns: emotionalObservations.filter((obs) =>
            obs.traitDimension.includes('anxiety'),
          ).length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        insights: {
          emotionalObservations: 0,
          totalObservations: 0,
          discoveredTraits: [],
        },
      };
    }
  }

  private async handleDetectRelationshipShift(
    params: z.infer<typeof DetectRelationshipShiftSchema>,
  ) {
    try {
      // Use RelationshipEvolutionService for intelligent analysis instead of hardcoded patterns
      return await this.relationshipEvolution.analyzeRelationshipShift(
        params.content,
        params.personaId,
        params.entityId,
        params.memoryId,
      );
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        detected: {
          hasSignificantChange: false,
          trustChange: 0,
          intimacyChange: 0,
          confidence: 0,
          indicators: [],
        },
      };
    }
  }

  private async handleUpdateEmotionalBond(params: z.infer<typeof UpdateEmotionalBondSchema>) {
    try {
      // Get existing relationship
      const relationship = await this.prisma.relationship.findUnique({
        where: {
          personaId_entityId: {
            personaId: params.personaId,
            entityId: params.entityId,
          },
        },
      });

      if (!relationship) {
        return {
          success: false,
          error: 'Relationship not found - use identifyEntity first',
          bond: null,
        };
      }

      // Update relationship using RelationshipEvolutionService
      // Note: This would need to be implemented in RelationshipEvolutionService
      const newTrustLevel = Math.max(0, Math.min(1, relationship.trustLevel + params.trustChange));
      const newIntimacyLevel = Math.max(
        0,
        Math.min(1, relationship.intimacyLevel + params.intimacyChange),
      );

      await this.prisma.relationship.update({
        where: { id: relationship.id },
        data: {
          trustLevel: newTrustLevel,
          intimacyLevel: newIntimacyLevel,
          lastInteraction: new Date(),
        },
      });

      return {
        success: true,
        bond: {
          previousTrust: relationship.trustLevel,
          newTrust: newTrustLevel,
          trustChange: params.trustChange,
          previousIntimacy: relationship.intimacyLevel,
          newIntimacy: newIntimacyLevel,
          intimacyChange: params.intimacyChange,
          reason: params.reason,
          updatedAt: new Date().toISOString(),
        },
        analysis: {
          bondStrength: (newTrustLevel + newIntimacyLevel) / 2,
          progressDirection:
            params.trustChange + params.intimacyChange > 0 ? 'strengthening' : 'weakening',
          trustLevel: newTrustLevel > 0.7 ? 'high' : newTrustLevel > 0.4 ? 'moderate' : 'low',
          intimacyLevel:
            newIntimacyLevel > 0.7 ? 'high' : newIntimacyLevel > 0.4 ? 'moderate' : 'low',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        bond: null,
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

  async run(mode: 'stdio' | 'http' = 'stdio', port = 3001) {
    if (mode === 'stdio') {
      const transport = new StdioServerTransport();

      try {
        await this.server.connect(transport);
        this.log('info', 'Persona Memory MCP Server started successfully (stdio)');
        console.error('Persona Memory MCP Server running on stdio');
      } catch (error) {
        this.log('error', 'Failed to start MCP server (stdio)', error);
        throw error;
      }
    } else {
      // HTTP mode with SSE transport
      const app = express();

      // Enable CORS for browser clients
      app.use(cors());
      app.use(express.json());

      // Store transports by session ID
      const transports: Record<string, SSEServerTransport> = {};

      // Health check endpoint
      app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'persona-memory-mcp' });
      });

      // SSE endpoint for establishing the stream
      app.get('/mcp', async (req, res) => {
        console.error('Establishing SSE stream...');
        try {
          // Create a new SSE transport for the client
          const transport = new SSEServerTransport('/messages', res);

          // Store the transport by session ID
          const sessionId = transport.sessionId;
          transports[sessionId] = transport;

          // Set up onclose handler to clean up transport when closed
          transport.onclose = () => {
            console.error(`SSE transport closed for session ${sessionId}`);
            delete transports[sessionId];
          };

          // Connect the transport to the MCP server
          await this.server.connect(transport);
          console.error(`Established SSE stream with session ID: ${sessionId}`);
        } catch (error) {
          console.error('Error establishing SSE stream:', error);
          if (!res.headersSent) {
            res.status(500).send('Error establishing SSE stream');
          }
        }
      });

      // Messages endpoint for receiving client JSON-RPC requests
      app.post('/messages', async (req, res) => {
        console.error('Received POST request to /messages');

        // Extract session ID from URL query parameter
        const sessionId = req.query.sessionId as string;
        if (!sessionId) {
          return res.status(400).send('Missing sessionId query parameter');
        }

        const transport = transports[sessionId];
        if (!transport) {
          return res.status(404).send('Session not found');
        }

        try {
          await transport.handlePostMessage(req, res, req.body);
        } catch (error) {
          console.error('Error handling POST message:', error);
          if (!res.headersSent) {
            res.status(500).send('Error handling message');
          }
        }
      });

      const httpServer = app.listen(port, '0.0.0.0', () => {
        this.log('info', `Persona Memory MCP Server started successfully (HTTP:${port})`);
        console.error(`Persona Memory MCP Server running on http://localhost:${port}`);
        console.error(`SSE endpoint: http://localhost:${port}/mcp`);
        console.error(`Messages endpoint: http://localhost:${port}/messages`);
      });

      // Graceful shutdown
      process.on('SIGINT', async () => {
        console.error('Shutting down HTTP MCP server...');
        httpServer.close();
        await this.close();
        process.exit(0);
      });
    }
  }

  async close() {
    await this.prisma.$disconnect();
  }
}

// Run the server if this is the main module
if (require.main === module) {
  const server = new PersonaMemoryMCPServer();

  // Check for HTTP mode via environment variable or argument
  const mode =
    process.env.MCP_MODE === 'http' || process.argv.includes('--http') ? 'http' : 'stdio';
  const port = Number.parseInt(process.env.MCP_PORT || '3001');

  if (mode === 'stdio') {
    process.on('SIGINT', async () => {
      await server.close();
      process.exit(0);
    });
  }

  server.run(mode, port).catch((error) => {
    console.error('Failed to run server:', error);
    process.exit(1);
  });
}
