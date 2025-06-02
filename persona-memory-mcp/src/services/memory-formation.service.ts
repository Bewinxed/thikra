import type {
  EmotionType,
  EmotionalState,
  Memory,
  MemoryType,
  Persona,
  PrismaClient,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { b } from '../../baml_client';
import type {
  ConversationEntityResult,
  DetectedEmotion,
  EmotionAnalysis,
  PADValues,
} from '../../baml_client/types';
import { PromptCache } from '../utils/prompt-cache';
import { bamlCache } from '../utils/baml-cache';
import type { EmbeddingService } from './embedding.service';
import type { MemoryGraphService } from './memory-graph.service';
import type { RelationshipEvolutionService } from './relationship-evolution.service';

// Define types that aren't in the schema
type MessageRole = 'user' | 'assistant' | 'system';

interface MemoryFormationParams {
  personaId: string;
  content: string;
  contentType?: string;
  participants?: string[];
  context?: Record<string, unknown>;
  significance?: number;
  tags?: string[];
}

interface ConversationMessage {
  role: MessageRole;
  content: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

interface ExtractedMemoryData {
  content: string;
  memoryType: MemoryType;
  significance: number;
  participants: string[];
  tags: string[];
  context: Record<string, unknown>;
  emotionalContext?: {
    emotions: string[];
    intensity: number;
    confidence: number;
  };
}

export class MemoryFormationService {
  private emotionCache: Map<string, EmotionType> = new Map();
  private promptCache: PromptCache;
  // Memory window will be calculated dynamically based on successful associations
  // Research: Recent memory effects typically span 3-14 days (Baddeley et al., 2015)

  constructor(
    private prisma: PrismaClient,
    private embeddingService: EmbeddingService,
    private memoryGraph: MemoryGraphService,
    private relationshipEvolution?: RelationshipEvolutionService,
  ) {
    this.promptCache = new PromptCache();
    this.loadEmotionTypes();
  }

  /**
   * Create memories from a conversation
   * @param personaId - The persona experiencing this conversation
   * @param messages - List of conversation messages
   * @param conversationContext - Additional context (channel, session, etc)
   */
  async createMemoriesFromConversation(
    personaId: string,
    messages: ConversationMessage[],
    conversationContext?: {
      channel?: string;
      sessionId?: string;
      personaName?: string;
      [key: string]: unknown;
    },
  ): Promise<Memory[]> {
    const memories: Memory[] = [];

    // Extract entities from the full conversation context using LLM
    const conversationEntities = await this.extractConversationEntities(
      messages,
      conversationContext,
    );

    // Create memories for each message
    for (const message of messages) {
      const memory = await this.createMemoryFromMessage(personaId, message, {
        ...conversationContext,
        conversationEntities,
      });
      memories.push(memory);
    }

    return memories;
  }

  /**
   * Create a memory from multi-modal content
   */
  async createMultiModalMemory(
    personaId: string,
    content: string,
    contentType: string,
    metadata?: Record<string, unknown>,
  ): Promise<Memory> {
    // Extract contextual information using LLM analysis
    const extractedData = await this.extractContentData(content, contentType, metadata);

    return this.createMemory({
      personaId,
      content,
      contentType,
      participants: extractedData.participants,
      context: extractedData.context,
      significance: extractedData.significance,
      tags: extractedData.tags,
    });
  }

  /**
   * Process a batch of conversation messages into memories
   */
  async processConversationBatch(
    personaId: string,
    messages: ConversationMessage[],
    conversationContext?: Record<string, unknown>,
  ): Promise<Memory[]> {
    const memories: Memory[] = [];

    for (const message of messages) {
      // Skip system messages
      if (message.role === 'system') {
        continue;
      }

      // Check if content is meaningful using LLM or config
      const isContentMeaningful = await this.isContentMeaningful(message.content);
      if (!isContentMeaningful) {
        continue;
      }

      try {
        const memory = await this.createMemoryFromMessage(personaId, message, conversationContext);
        memories.push(memory);

        // Create associations between consecutive memories
        if (memories.length > 1) {
          await this.memoryGraph.buildAssociationsForMemory(memory.id);
        }
      } catch (error) {
        console.error('Failed to create memory from message:', error);
        // Continue with other messages even if one fails
      }
    }

    return memories;
  }

  /**
   * Create a memory from a single conversation message
   * (Should be called from createMemoriesFromConversation for proper context)
   */
  private async createMemoryFromMessage(
    personaId: string,
    message: ConversationMessage,
    context?: Record<string, unknown>,
  ): Promise<Memory> {
    const extractedData = await this.extractMemoryData(message, context);

    return this.createMemory({
      personaId,
      content: extractedData.content,
      contentType: 'text',
      participants: extractedData.participants,
      context: extractedData.context,
      significance: extractedData.significance,
      tags: extractedData.tags,
    });
  }

  /**
   * Create a memory with full processing pipeline
   */
  private async createMemory(params: MemoryFormationParams): Promise<Memory> {
    const {
      personaId,
      content,
      contentType = 'text',
      participants = [],
      context = {},
      significance,
      tags = [],
    } = params;

    // Validate required parameters
    if (!personaId || !content) {
      throw new Error('PersonaId and content are required for memory formation');
    }

    // Significance must be provided or calculated, never defaulted
    if (significance === undefined || significance === null) {
      throw new Error('Memory significance must be provided or calculated, not defaulted');
    }

    // BATCH PROCESSING: Run embedding, emotional analysis, and memory type in parallel
    const [embedding, memoryType, hasEmotionalContentResult] = await Promise.all([
      this.embeddingService.embed(content),
      this.determineMemoryType(content, contentType, context),
      contentType === 'text' ? this.hasEmotionalContent(content) : Promise.resolve(false),
    ]);

    // Create emotional state if content has emotional content
    let emotionalStateId: string | null = null;
    if (hasEmotionalContentResult) {
      const emotionAnalysis = await this.detectEmotions(content);
      if (
        emotionAnalysis.primaryEmotions.length > 0 ||
        emotionAnalysis.secondaryEmotions.length > 0
      ) {
        emotionalStateId = await this.createEmotionalState(emotionAnalysis, content);
      }
    }

    // Create the memory record
    const memory = await this.prisma.memory.create({
      data: {
        personaId,
        memoryType,
        contentType,
        searchText: content,
        emotionalStateId,
        significanceScore: significance,
        occurredAt: new Date(),
        tags,
        // Note: embedding and searchVector will be set via raw SQL
      },
      include: {
        emotionalState: {
          include: {
            components: true,
          },
        },
      },
    });

    // Create participant relationships if any
    if (participants.length > 0) {
      await this.createMemoryParticipants(memory.id, participants);
    }

    // Update the memory with embedding and search vector via raw SQL
    const searchVector = await this.generateSearchVector(content, tags);
    await this.prisma.$executeRaw`
      UPDATE "Memory" 
      SET 
        embedding = ${JSON.stringify(embedding)}::vector,
        "searchVector" = to_tsvector('english', ${searchVector})
      WHERE id = ${memory.id}::uuid
    `;

    // Create consolidation record for memory tracking
    await this.prisma.memoryConsolidation.create({
      data: {
        memoryId: memory.id,
        // initialStrength defaults to 1.0 in schema
        currentStrength: significance,
      },
    });

    // Create associations with related memories
    await this.memoryGraph.buildAssociationsForMemory(memory.id);

    // RELATIONSHIP EVOLUTION: Process new memory for relationship changes
    await this.processRelationshipEvolution(memory, participants);

    return memory;
  }

  /**
   * Extract memory data from conversation message using LLM analysis
   */
  private async extractMemoryData(
    message: ConversationMessage,
    context?: Record<string, unknown>,
  ): Promise<ExtractedMemoryData> {
    const content = message.content;

    // Extract participants for this message from conversation context
    const conversationEntities = context?.conversationEntities as Map<
      string,
      { entityId: string; entityType: string; role: string }
    >;
    const participantIds = conversationEntities
      ? await this.extractMessageParticipants(message, conversationEntities)
      : [];

    // BATCH PROCESSING: Run LLM analysis in parallel instead of sequentially
    const [tags, significance, memoryType, emotionalContext] = await Promise.all([
      this.generateContentTags(content),
      this.assessContentSignificance(content, message.role, context),
      this.determineMemoryType(content, 'text', context),
      this.extractEmotionalContext(content),
    ]);

    return {
      content,
      memoryType,
      significance,
      participants: participantIds,
      tags,
      context: {
        role: message.role,
        timestamp: message.timestamp || new Date(),
        ...context,
        ...message.metadata,
      },
      emotionalContext,
    };
  }

  /**
   * Extract data from multi-modal content using LLM analysis
   */
  private async extractContentData(
    content: string,
    contentType: string,
    metadata?: Record<string, unknown>,
  ): Promise<ExtractedMemoryData> {
    // Use LLM to analyze content and extract participants
    const participants: string[] = []; // TODO: Implement multi-modal participant extraction

    // Generate tags using LLM
    const tags = await this.generateContentTags(content);

    // Assess significance using LLM
    const significance = await this.assessContentSignificance(content, contentType, metadata);

    // Determine memory type using LLM
    const memoryType = await this.determineMemoryType(content, contentType, metadata);

    return {
      content,
      memoryType,
      significance,
      participants,
      tags,
      context: {
        contentType,
        ...metadata,
      },
    };
  }

  /**
   * Determine memory type using LLM analysis - NO HARDCODING
   */
  private async determineMemoryType(
    content: string,
    contentType: string,
    context?: Record<string, unknown>,
  ): Promise<MemoryType> {
    try {
      const contextStr = context ? JSON.stringify(context) : 'No additional context';
      const classification = await bamlCache.call(
        'ClassifyMemoryType',
        [content, contextStr],
        () => b.ClassifyMemoryType(content, contextStr)
      );

      // Map BAML enum to Prisma enum
      const memoryTypeMap: Record<string, MemoryType> = {
        Episodic: 'episodic',
        Semantic: 'semantic',
        Procedural: 'procedural',
      };

      const mappedType = memoryTypeMap[classification.memoryType];
      if (!mappedType) {
        throw new Error(`Unknown memory type from LLM: ${classification.memoryType}`);
      }

      return mappedType;
    } catch (error) {
      console.error('Failed to classify memory type with LLM:', error);
      throw new Error('Memory type classification failed - refusing to use fallback hardcoding');
    }
  }

  /**
   * Generate tags using LLM analysis - NO HARDCODING
   */
  private async generateContentTags(content: string): Promise<string[]> {
    try {
      const tagResult = await bamlCache.callSingle(
        'GenerateContentTags',
        content,
        () => b.GenerateContentTags(content)
      );

      // Combine all tag types into a flat array
      const allTags = [
        ...tagResult.primaryTags,
        ...tagResult.emotionalTags,
        ...tagResult.conceptualTags,
        ...tagResult.contextualTags,
      ];

      // Remove duplicates and return
      return [...new Set(allTags)];
    } catch (error) {
      console.error('Failed to generate tags with LLM:', error);
      throw new Error('Tag generation failed - refusing to use fallback hardcoding');
    }
  }

  /**
   * Assess content significance using LLM analysis - NO HARDCODING
   */
  private async assessContentSignificance(
    content: string,
    speakerRole: string | Record<string, unknown>,
    context?: Record<string, unknown>,
  ): Promise<number> {
    try {
      const role = typeof speakerRole === 'string' ? speakerRole : 'unknown';
      const contextStr = context ? JSON.stringify(context) : 'No additional context';

      const significance = await bamlCache.call(
        'AssessContentSignificance',
        [content, role, contextStr],
        () => b.AssessContentSignificance(content, role, contextStr)
      );

      // Validate the score is in valid range
      if (significance.significanceScore < 0 || significance.significanceScore > 1) {
        throw new Error(`Invalid significance score: ${significance.significanceScore}`);
      }

      return significance.significanceScore;
    } catch (error) {
      console.error('Failed to assess significance with LLM:', error);
      throw new Error('Significance assessment failed - refusing to use fallback hardcoding');
    }
  }

  /**
   * Get relevant entities using Anthropic's Contextual Retrieval approach
   * Based on: https://www.anthropic.com/news/contextual-retrieval
   */
  private async getRelevantEntitiesContext(
    channel: string,
    messages: ConversationMessage[],
  ): Promise<string> {
    try {
      // Extract entity relevance query from conversation messages
      const query = this.extractEntityRelevanceQuery(messages);

      // Use semantic search to find relevant entities instead of sending ALL
      const relevantEntityIds = await this.findRelevantEntities(channel, query, 20);

      if (relevantEntityIds.length === 0) {
        return 'No existing entities in this channel.';
      }

      // Get detailed info for relevant entities only
      const relevantEntities = await this.prisma.entity.findMany({
        where: {
          id: { in: relevantEntityIds },
        },
        select: {
          name: true,
          entityType: true,
          identificationMarkers: true,
        },
      });

      // Format with contextual descriptions (Anthropic's approach)
      const entityDescriptions = relevantEntities.map((entity) => {
        const markers = (entity.identificationMarkers as Record<string, unknown>) || {};
        const originalForm = (markers.original_form as string) || entity.name;
        const role = (markers.conversationRole as string) || 'unknown';
        const context = this.buildEntityContextDescription(entity, markers);

        return `- ${entity.name} (${entity.entityType}): ${context}, originally "${originalForm}", role: ${role}`;
      });

      return `Relevant entities in channel "${channel}":\n${entityDescriptions.join('\n')}`;
    } catch (error) {
      console.error('Failed to get relevant entities context:', error);
      // Fallback to simpler method if relevance detection fails
      return this.getRecentEntitiesContext(channel, 10);
    }
  }

  /**
   * Extract entity relevance query from conversation messages
   */
  private extractEntityRelevanceQuery(messages: ConversationMessage[]): string {
    // Combine recent message content to understand who might be relevant
    const recentContent = messages
      .slice(-3) // Last 3 messages for context
      .map((m) => m.content)
      .join(' ')
      .toLowerCase();

    // Extract key terms that suggest entity relevance
    const relevanceTerms = [];

    // Direct entity references
    if (recentContent.includes('master') || recentContent.includes('user')) {
      relevanceTerms.push('master user relationship');
    }

    // Conversation participants
    if (recentContent.includes('we') || recentContent.includes('us')) {
      relevanceTerms.push('conversation participants');
    }

    // Mentioned third parties
    const pronouns = ['he', 'she', 'they', 'him', 'her', 'them'];
    if (pronouns.some((p) => recentContent.includes(p))) {
      relevanceTerms.push('third party mentions');
    }

    return relevanceTerms.length > 0 ? relevanceTerms.join(' ') : recentContent.substring(0, 200); // Fallback to content sample
  }

  /**
   * Find relevant entities using semantic similarity and temporal proximity
   */
  private async findRelevantEntities(
    channel: string,
    query: string,
    maxResults: number,
  ): Promise<string[]> {
    // Use temporal proximity - entities from recent memories are more likely relevant
    // Calculate data-driven recency window based on successful memory associations
    const recentWindowMs = await this.calculateRecentMemoryWindow(channel);

    const recentMemories = await this.prisma.memory.findMany({
      where: {
        channel,
        occurredAt: {
          gte: new Date(Date.now() - recentWindowMs),
        },
      },
      include: {
        participants: {
          include: {
            entity: true,
          },
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });

    // Extract unique entity IDs from recent memories
    const recentEntityIds = new Set<string>();
    for (const memory of recentMemories) {
      for (const participant of memory.participants) {
        recentEntityIds.add(participant.entityId);
      }
    }

    // If we have query terms, do semantic matching
    const isQueryMeaningful = await this.isContentMeaningful(query);
    if (isQueryMeaningful) {
      // TODO: Could enhance with embedding similarity search
      // For now, use simple text matching against entity markers
      const entities = await this.prisma.entity.findMany({
        where: {
          OR: [
            { firstContactChannel: channel },
            {
              identificationMarkers: {
                path: ['channel'],
                equals: channel,
              },
            },
          ],
        },
      });

      // Score entities by LLM-based relevance analysis
      const scoredEntities = await Promise.all(
        entities.map(async (entity) => {
          try {
            const entityInfo = JSON.stringify({
              name: entity.name,
              type: entity.entityType,
              markers: entity.identificationMarkers,
              recentlyActive: recentEntityIds.has(entity.id),
            });

            const relevanceAnalysis = await bamlCache.call(
              'CalculateEntityRelevance',
              [entityInfo, query],
              () => b.CalculateEntityRelevance(entityInfo, query)
            );

            // Apply recency boost to LLM score if entity was recently active
            let finalScore = relevanceAnalysis.relevanceScore;
            if (recentEntityIds.has(entity.id)) {
              finalScore = Math.min(1.0, finalScore * 1.2); // 20% boost for recent activity
            }

            return {
              entity,
              score: finalScore,
              reasoning: relevanceAnalysis.reasoning,
            };
          } catch (error) {
            console.error(`Failed to analyze entity relevance for ${entity.name}:`, error);
            // Use fallback scoring only for recent activity to avoid complete failure
            const score = recentEntityIds.has(entity.id) ? 0.7 : 0.1;
            return {
              entity,
              score,
              reasoning: 'Fallback scoring due to LLM failure',
            };
          }
        }),
      );

      const filteredEntities = scoredEntities
        .filter((item) => item.score > 0.1) // Minimum relevance threshold
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      return filteredEntities.map((item) => item.entity.id);
    }

    // Fallback to recent entities only
    return Array.from(recentEntityIds).slice(0, maxResults);
  }

  /**
   * Build contextual description for entity (Anthropic's approach)
   */
  private buildEntityContextDescription(
    entity: { name: string | null; entityType: string },
    markers: Record<string, unknown>,
  ): string {
    const context = [];

    if (markers.conversationRole) {
      context.push(`${markers.conversationRole} in conversations`);
    }

    if (markers.relationship_type) {
      context.push(`relationship type: ${markers.relationship_type}`);
    }

    if (markers.interaction_frequency) {
      context.push(`${markers.interaction_frequency} interactions`);
    }

    return context.length > 0 ? context.join(', ') : `${entity.entityType} entity`;
  }

  /**
   * Fallback method for simple recent entities (when relevance detection fails)
   */
  private async getRecentEntitiesContext(channel: string, limit: number): Promise<string> {
    const recentEntities = await this.prisma.entity.findMany({
      where: {
        OR: [
          { firstContactChannel: channel },
          {
            identificationMarkers: {
              path: ['channel'],
              equals: channel,
            },
          },
        ],
      },
      select: {
        name: true,
        entityType: true,
        identificationMarkers: true,
      },
      orderBy: { id: 'desc' },
      take: limit,
    });

    if (recentEntities.length === 0) {
      return 'No existing entities in this channel.';
    }

    const entityDescriptions = recentEntities.map((entity) => {
      const markers = (entity.identificationMarkers as Record<string, unknown>) || {};
      const originalForm = (markers.original_form as string) || entity.name;

      return `- ${entity.name} (${entity.entityType}): originally "${originalForm}"`;
    });

    return `Recent entities in channel "${channel}":\n${entityDescriptions.join('\n')}`;
  }

  /**
   * Extract all entities from a full conversation using LLM - NO HARDCODING
   */
  private async extractConversationEntities(
    messages: ConversationMessage[],
    context?: { channel?: string; personaName?: string; [key: string]: unknown },
  ): Promise<Map<string, { entityId: string; entityType: string; role: string }>> {
    const entityMap = new Map<string, { entityId: string; entityType: string; role: string }>();
    const personaName = context?.personaName || 'assistant';
    const channel = context?.channel || 'default';

    // Get relevant entities using Anthropic's Contextual Retrieval approach
    const existingEntities = await this.getRelevantEntitiesContext(channel, messages);

    // Call BAML function to extract entities
    const messagesJson = JSON.stringify(
      messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    );

    try {
      const entityResult = await bamlCache.call(
        'ExtractConversationEntities',
        [messagesJson, personaName, channel, existingEntities],
        () => b.ExtractConversationEntities(messagesJson, personaName, channel, existingEntities)
      );

      // Process extracted entities and handle consolidation properly
      const entityTypeMap: Record<string, 'human' | 'llm' | 'system' | 'unknown'> = {
        Human: 'human',
        Llm: 'llm',
        System: 'system',
        Unknown: 'unknown',
      };

      // Group entities by consolidated name to track all original references
      const consolidatedEntities = new Map<
        string,
        {
          consolidatedName: string;
          entityType: string;
          originalReferences: string[];
          roles: string[];
        }
      >();

      for (const entity of entityResult.entities) {
        const consolidatedKey = entity.name.toLowerCase();

        if (!consolidatedEntities.has(consolidatedKey)) {
          consolidatedEntities.set(consolidatedKey, {
            consolidatedName: entity.name,
            entityType: entity.entityType,
            originalReferences: [],
            roles: [],
          });
        }

        const consolidated = consolidatedEntities.get(consolidatedKey);
        if (!consolidated) continue;
        consolidated.originalReferences.push(entity.originalReference);
        consolidated.roles.push(entity.role);
      }

      // Create/find database entities and map ALL references to the same ID
      for (const [consolidatedKey, entityInfo] of consolidatedEntities) {
        const mappedType = entityTypeMap[entityInfo.entityType];
        if (!mappedType) {
          throw new Error(`Unknown entity type from LLM: ${entityInfo.entityType}`);
        }

        // Find or create the database entity using the consolidated name
        const dbEntity = await this.findOrCreateEntity(
          entityInfo.consolidatedName,
          mappedType,
          channel,
        );

        // Map the consolidated name to the database entity
        const primaryRole = entityInfo.roles[0] || 'participant';
        entityMap.set(consolidatedKey, {
          entityId: dbEntity.id,
          entityType: dbEntity.entityType,
          role: primaryRole,
        });

        // IMPORTANT: Also map all original references to the same database entity ID
        for (const originalRef of entityInfo.originalReferences) {
          const originalKey = originalRef.toLowerCase();
          if (originalKey !== consolidatedKey) {
            entityMap.set(originalKey, {
              entityId: dbEntity.id,
              entityType: dbEntity.entityType,
              role: primaryRole,
            });
          }
        }
      }

      // Ensure we have basic mappings for conversation roles
      if (!entityMap.has('assistant') && entityResult.speakerEntity) {
        const speaker = entityMap.get(entityResult.speakerEntity.toLowerCase());
        if (speaker) {
          entityMap.set('assistant', speaker);
        }
      }
    } catch (error) {
      console.error('Failed to extract entities with LLM:', error);
      throw new Error('Entity extraction failed - refusing to use fallback hardcoding');
    }

    return entityMap;
  }

  /**
   * Extract participants for a single message based on conversation context
   */
  private async extractMessageParticipants(
    message: ConversationMessage,
    conversationEntities: Map<string, { entityId: string; entityType: string; role: string }>,
  ): Promise<string[]> {
    const participantIds: string[] = [];

    // Speaker is always a participant
    const speaker =
      message.role === 'assistant'
        ? conversationEntities.get('assistant')
        : conversationEntities.get('user');

    if (speaker) {
      participantIds.push(speaker.entityId);
    }

    // In conversations, there's usually an implicit addressee
    const addressee =
      message.role === 'assistant'
        ? conversationEntities.get('user')
        : conversationEntities.get('assistant');

    if (addressee) {
      participantIds.push(addressee.entityId);
    }

    // TODO: Use LLM to detect third-party mentions in content

    return [...new Set(participantIds)];
  }

  /**
   * Extract emotional context from content using existing LLM emotion detection
   */
  private async extractEmotionalContext(content: string): Promise<
    | {
        emotions: string[];
        intensity: number;
        confidence: number;
      }
    | undefined
  > {
    try {
      const emotionAnalysis = await this.detectEmotions(content);

      if (
        emotionAnalysis.primaryEmotions.length === 0 &&
        emotionAnalysis.secondaryEmotions.length === 0
      ) {
        return undefined;
      }

      const emotions = [
        ...emotionAnalysis.primaryEmotions.map((e) => e.emotionName),
        ...emotionAnalysis.secondaryEmotions.map((e) => e.emotionName),
      ];

      // Calculate average intensity and confidence
      const allEmotions = [
        ...emotionAnalysis.primaryEmotions,
        ...emotionAnalysis.secondaryEmotions,
      ];
      const avgIntensity =
        allEmotions.reduce((sum, e) => sum + e.intensity, 0) / allEmotions.length;
      const avgConfidence =
        allEmotions.reduce((sum, e) => sum + e.confidence, 0) / allEmotions.length;

      return {
        emotions: [...new Set(emotions)],
        intensity: avgIntensity,
        confidence: avgConfidence,
      };
    } catch (error) {
      console.error('Failed to extract emotional context:', error);
      return undefined;
    }
  }

  /**
   * Generate search vector for full-text search
   */
  private async generateSearchVector(content: string, tags: string[]): Promise<string> {
    // Combine content and tags for search
    const searchText = [content, ...tags].join(' ').toLowerCase();

    // Clean and normalize text
    return searchText
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Create an emotional state record from emotion analysis using LLM data
   */
  private async createEmotionalState(
    emotionAnalysis: EmotionAnalysis,
    content: string,
  ): Promise<string> {
    // Create the main emotional state record
    const emotionalState = await this.prisma.emotionalState.create({
      data: {
        // Note: EmotionalState doesn't have personaId, stateType, or context fields in schema
      },
    });

    // Process primary emotions using LLM-detected emotions and PAD values
    for (const emotion of emotionAnalysis.primaryEmotions) {
      const emotionType = await this.findOrCreateEmotionType(emotion, emotionAnalysis.padValues);

      await this.prisma.emotionalStateComponent.create({
        data: {
          emotionalStateId: emotionalState.id,
          emotionTypeId: emotionType.id,
          intensity: emotion.intensity,
          voiceModulation: {
            detected_from: 'llm_analysis',
            emotion_type: 'primary',
            content_preview: content.substring(0, 100),
          } as Prisma.InputJsonValue,
        },
      });
    }

    // Process secondary emotions
    for (const emotion of emotionAnalysis.secondaryEmotions) {
      const emotionType = await this.findOrCreateEmotionType(emotion, emotionAnalysis.padValues);

      await this.prisma.emotionalStateComponent.create({
        data: {
          emotionalStateId: emotionalState.id,
          emotionTypeId: emotionType.id,
          intensity: emotion.intensity,
          voiceModulation: {
            detected_from: 'llm_analysis',
            emotion_type: 'secondary',
            content_preview: content.substring(0, 100),
          } as Prisma.InputJsonValue,
        },
      });
    }

    return emotionalState.id;
  }

  /**
   * Find or create an emotion type using LLM-provided PAD values - NO HARDCODING
   */
  private async findOrCreateEmotionType(
    emotion: DetectedEmotion,
    padValues: PADValues,
  ): Promise<EmotionType> {
    // Try to find existing emotion type
    let emotionType = await this.prisma.emotionType.findFirst({
      where: {
        emotionName: {
          equals: emotion.emotionName,
          mode: 'insensitive',
        },
      },
    });

    // Create if doesn't exist using LLM-provided PAD values
    if (!emotionType) {
      // Validate intensity is in valid range
      if (emotion.intensity < 0 || emotion.intensity > 1) {
        throw new Error(`Invalid emotion intensity: ${emotion.intensity}`);
      }

      emotionType = await this.prisma.emotionType.create({
        data: {
          primaryEmotion: 'custom', // All LLM-detected emotions are custom
          intensityLevel: Math.round(emotion.intensity * 3) + 1, // Convert 0-1 to 1-4
          emotionName: emotion.emotionName,
          pleasureComponent: padValues.pleasure,
          arousalComponent: padValues.arousal,
          dominanceComponent: padValues.dominance,
        },
      });
    }

    return emotionType;
  }

  /**
   * Create memory participant relationships
   */
  private async createMemoryParticipants(
    memoryId: string,
    participantEntityIds: string[],
  ): Promise<void> {
    for (const entityId of participantEntityIds) {
      // Check if relationship already exists
      const existingParticipant = await this.prisma.memoryParticipant.findUnique({
        where: {
          memoryId_entityId: {
            memoryId,
            entityId,
          },
        },
      });

      if (!existingParticipant) {
        // Create memory participant relationship
        await this.prisma.memoryParticipant.create({
          data: {
            memoryId,
            entityId,
            role: 'participant', // Generic role since we already have entity types
          },
        });
      }
    }
  }

  /**
   * Find or create an entity - uses LLM entity type determination
   */
  private async findOrCreateEntity(
    name: string,
    entityType: 'human' | 'llm' | 'system' | 'unknown',
    channel?: string,
  ) {
    // Validate required parameters
    if (!name || !entityType) {
      throw new Error('Name and entityType are required for entity creation');
    }

    // Normalize the name
    const normalizedName = name.trim().toLowerCase();

    // Try to find existing entity
    let entity = await this.prisma.entity.findFirst({
      where: {
        name: {
          equals: normalizedName,
          mode: 'insensitive',
        },
      },
    });

    // Create if doesn't exist
    if (!entity) {
      // Determine metadata based on entity type
      const metadata: Record<string, unknown> = {
        source: 'llm_extraction',
        original_form: name,
        normalized_form: normalizedName,
      };

      if (channel) {
        metadata.channel = channel;
      }

      // Validate entity type is known
      const validTypes = ['human', 'llm', 'system', 'unknown'];
      if (!validTypes.includes(entityType)) {
        throw new Error(`Invalid entity type: ${entityType}`);
      }

      entity = await this.prisma.entity.create({
        data: {
          name: normalizedName,
          entityType,
          firstContactChannel: channel || 'memory_formation',
          identificationMarkers: metadata as Prisma.InputJsonValue,
        },
      });
    }

    return entity;
  }

  /**
   * Load emotion types from database into cache
   */
  private async loadEmotionTypes() {
    const emotions = await this.prisma.emotionType.findMany();
    for (const emotion of emotions) {
      this.emotionCache.set(emotion.emotionName.toLowerCase(), emotion);
    }
  }

  /**
   * Check if content is substantial enough to warrant emotional analysis
   */
  private async hasEmotionalContent(content: string): Promise<boolean> {
    const analysis = await bamlCache.callSingle(
      'CheckEmotionalContent',
      content,
      () => b.CheckEmotionalContent(content)
    );
    return analysis.hasEmotionalContent;
  }

  /**
   * Detect emotions in text using LLM (integrated from emotion-detector service)
   */
  private async detectEmotions(text: string): Promise<EmotionAnalysis> {
    try {
      return await bamlCache.callSingle(
        'AnalyzeEmotions',
        text,
        () => b.AnalyzeEmotions(text)
      );
    } catch (error) {
      console.error('Error detecting emotions:', error);
      throw new Error('Emotion detection failed - no fallback available');
    }
  }

  /**
   * Check if content is meaningful enough to create a memory
   */
  private async isContentMeaningful(content: string): Promise<boolean> {
    const analysis = await bamlCache.callSingle(
      'CheckContentMeaningfulness',
      content,
      () => b.CheckContentMeaningfulness(content)
    );
    return analysis.isMeaningful;
  }

  /**
   * Calculate entity relevance score using LLM analysis
   */
  private async calculateEntityRelevance(entity: any, query: string): Promise<number> {
    const entityContext = JSON.stringify({
      name: entity.name,
      type: entity.entityType,
      markers: entity.identificationMarkers,
    });

    const analysis = await bamlCache.call(
      'CalculateEntityRelevance',
      [entityContext, query],
      () => b.CalculateEntityRelevance(entityContext, query)
    );
    return analysis.relevanceScore;
  }

  /**
   * Calculate reinforcement boost for memory consolidation
   */
  private async calculateReinforcementBoost(memory: Memory): Promise<number> {
    const memoryContext = JSON.stringify({
      content: memory.searchText,
      significance: memory.significanceScore,
      type: memory.memoryType,
      age: memory.occurredAt ? Date.now() - memory.occurredAt.getTime() : 0,
      strength: memory.memoryStrength,
    });

    const analysis = await bamlCache.callSingle(
      'CalculateReinforcementBoost',
      memoryContext,
      () => b.CalculateReinforcementBoost(memoryContext)
    );
    return analysis.boostAmount;
  }

  /**
   * Calculate recent memory window based on successful association patterns
   * Research: Embodied temporal proximity in memory association (Baddeley et al., 2015)
   */
  private async calculateRecentMemoryWindow(channel: string): Promise<number> {
    // Query temporal gaps between memories that formed successful associations
    const successfulAssociations = await this.prisma.memoryAssociation.findMany({
      where: {
        associationType: 'temporal',
        associationStrength: { gt: 0.5 }, // Associations that proved meaningful
      },
      include: {
        memoryARelation: { select: { occurredAt: true, channel: true } },
        memoryBRelation: { select: { occurredAt: true, channel: true } },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    // Filter associations from the same channel
    const channelAssociations = successfulAssociations.filter(
      (assoc) =>
        assoc.memoryARelation.channel === channel || assoc.memoryBRelation.channel === channel,
    );

    if (channelAssociations.length === 0) {
      // Research-based fallback: 7 days is typical episodic memory window (Baddeley et al., 2015)
      return 7 * 24 * 60 * 60 * 1000;
    }

    // Calculate time gaps between successfully associated memories
    const timeGaps: number[] = [];
    for (const assoc of channelAssociations) {
      if (assoc.memoryBRelation.occurredAt && assoc.memoryARelation.occurredAt) {
        const gap = Math.abs(
          assoc.memoryBRelation.occurredAt.getTime() - assoc.memoryARelation.occurredAt.getTime(),
        );
        if (gap > 0) {
          timeGaps.push(gap);
        }
      }
    }

    if (timeGaps.length === 0) {
      return 7 * 24 * 60 * 60 * 1000; // Fallback to research default
    }

    // Use 80th percentile of successful association time gaps
    timeGaps.sort((a, b) => a - b);
    const percentile80 = timeGaps[Math.floor(timeGaps.length * 0.8)] || 7 * 24 * 60 * 60 * 1000;

    // Constrain to research bounds: 1-14 days per episodic memory research
    const minWindow = 1 * 24 * 60 * 60 * 1000; // 1 day
    const maxWindow = 14 * 24 * 60 * 60 * 1000; // 14 days

    return Math.min(Math.max(percentile80, minWindow), maxWindow);
  }

  /**
   * Process relationship evolution based on new memory
   * Triggers after memory creation to update relationship dynamics
   */
  private async processRelationshipEvolution(
    memory: Memory & { emotionalState?: any },
    participantIds: string[],
  ): Promise<void> {
    // Only process if we have relationship evolution service and participants
    if (!this.relationshipEvolution || participantIds.length === 0) {
      return;
    }

    try {
      // Find relationships between persona and memory participants
      const relationships = await this.prisma.relationship.findMany({
        where: {
          personaId: memory.personaId,
          entityId: {
            in: participantIds,
          },
        },
      });

      // Process each relationship for potential evolution
      for (const relationship of relationships) {
        await this.relationshipEvolution.processNewMemory(memory, relationship);
      }
    } catch (error) {
      // Log but don't fail memory creation for relationship processing errors
      console.warn('Failed to process relationship evolution:', error);
    }
  }
}
