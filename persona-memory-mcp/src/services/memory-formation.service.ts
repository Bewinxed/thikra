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
  DetectedEmotion,
  EmotionAnalysis,
  EmotionMetadata,
  EmotionalTransition,
  PADValues,
} from '../../baml_client/types';
import type { EmbeddingService } from './embedding.service';
import type { MemoryGraphService } from './memory-graph.service';
import { PromptCache } from '../utils/prompt-cache';

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

interface DetectedEmotionWithId extends DetectedEmotion {
  emotionTypeId?: string;
}

export class MemoryFormationService {
  private emotionCache: Map<string, EmotionType> = new Map();
  private promptCache: PromptCache;

  constructor(
    private prisma: PrismaClient,
    private embeddingService: EmbeddingService,
    private memoryGraph: MemoryGraphService,
  ) {
    this.promptCache = new PromptCache();
    this.loadEmotionTypes();
  }

  /**
   * Create a memory from a conversation message
   */
  async createMemoryFromMessage(
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
   * Create a memory from multi-modal content
   */
  async createMultiModalMemory(
    personaId: string,
    content: string,
    contentType: string,
    metadata?: Record<string, unknown>,
  ): Promise<Memory> {
    // Extract contextual information based on content type
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
      // Skip system messages or very short messages
      if (message.role === 'system' || message.content.length < 10) {
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
   * Create a memory with full processing pipeline
   */
  private async createMemory(params: MemoryFormationParams): Promise<Memory> {
    const {
      personaId,
      content,
      contentType = 'text',
      participants = [],
      context = {},
      significance = 0.5,
      tags = [],
    } = params;

    // Generate embedding for content
    const embedding = await this.embeddingService.embed(content);

    // Detect and create emotional state if content is text
    let emotionalStateId: string | null = null;
    if (contentType === 'text') {
      const emotionAnalysis = await this.detectEmotions(content);
      if (
        emotionAnalysis.primaryEmotions.length > 0 ||
        emotionAnalysis.secondaryEmotions.length > 0
      ) {
        emotionalStateId = await this.createEmotionalState(emotionAnalysis, content);
      }
    }

    // Determine memory type based on content analysis
    const memoryType = await this.determineMemoryType(content, contentType, context);

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

    // Create associations with related memories
    await this.memoryGraph.buildAssociationsForMemory(memory.id);

    return memory;
  }

  /**
   * Extract memory data from conversation message
   */
  private async extractMemoryData(
    message: ConversationMessage,
    context?: Record<string, unknown>,
  ): Promise<ExtractedMemoryData> {
    const content = message.content;

    // Extract participants mentioned in the message
    const participants = this.extractParticipants(content);

    // Generate tags based on content analysis
    const tags = await this.generateTags(content);

    // Calculate significance based on content analysis
    const significance = await this.calculateSignificance(content, message.role);

    // Determine memory type
    const memoryType = await this.determineMemoryType(content, 'text', context);

    // Extract emotional context
    const emotionalContext = await this.extractEmotionalContext(content);

    return {
      content,
      memoryType,
      significance,
      participants,
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
   * Extract data from multi-modal content
   */
  private async extractContentData(
    content: string,
    contentType: string,
    metadata?: Record<string, unknown>,
  ): Promise<ExtractedMemoryData> {
    // Basic extraction - could be enhanced with vision/audio analysis
    const participants: string[] = [];
    const tags: string[] = [contentType];

    let significance = 0.5;

    // Adjust significance based on content type
    switch (contentType) {
      case 'image':
        significance = 0.7; // Visual memories tend to be more significant
        tags.push('visual', 'image');
        break;
      case 'audio':
        significance = 0.6;
        tags.push('audio', 'sound');
        break;
      case 'video':
        significance = 0.8; // Video combines visual and audio
        tags.push('visual', 'audio', 'video');
        break;
      default:
        significance = 0.5;
    }

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
   * Determine memory type based on content analysis
   */
  private async determineMemoryType(
    content: string,
    contentType: string,
    _context?: Record<string, unknown>,
  ): Promise<MemoryType> {
    // Simple heuristics - could be enhanced with LLM analysis

    if (contentType !== 'text') {
      return 'episodic'; // Multi-modal memories are typically episodic
    }

    const lowerContent = content.toLowerCase();

    // Check for procedural knowledge
    if (
      lowerContent.includes('how to') ||
      lowerContent.includes('step') ||
      lowerContent.includes('process') ||
      lowerContent.includes('method')
    ) {
      return 'procedural';
    }

    // Check for factual information
    if (
      lowerContent.includes('fact') ||
      lowerContent.includes('definition') ||
      lowerContent.includes('means') ||
      lowerContent.includes('is a') ||
      lowerContent.includes('are a')
    ) {
      return 'semantic';
    }

    // Check for personal experiences
    if (
      lowerContent.includes('i ') ||
      lowerContent.includes('me ') ||
      lowerContent.includes('my ') ||
      lowerContent.includes('we ') ||
      lowerContent.includes('remember') ||
      lowerContent.includes('happened')
    ) {
      return 'episodic';
    }

    // Default to episodic for conversational content
    return 'episodic';
  }

  /**
   * Extract participants mentioned in content
   */
  private extractParticipants(content: string): string[] {
    const participants: string[] = [];

    // Simple name extraction - could be enhanced with NER
    const namePatterns = [
      /\b[A-Z][a-z]+\b/g, // Simple capitalized words
      /\b(?:I|you|we|they|he|she)\b/gi, // Pronouns
    ];

    for (const pattern of namePatterns) {
      const matches = content.match(pattern);
      if (matches) {
        participants.push(
          ...matches.filter(
            (name) =>
              name.length > 1 && !['The', 'This', 'That', 'And', 'Or', 'But'].includes(name),
          ),
        );
      }
    }

    return [...new Set(participants)]; // Remove duplicates
  }

  /**
   * Generate tags for content
   */
  private async generateTags(content: string): Promise<string[]> {
    const tags: string[] = [];

    // Extract simple keywords
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3);

    // Count word frequency
    const wordFreq: Record<string, number> = {};
    for (const word of words) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }

    // Select top frequent words as tags
    const sortedWords = Object.entries(wordFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word);

    tags.push(...sortedWords);

    // Add content-based tags
    if (content.includes('?')) tags.push('question');
    if (content.includes('!')) tags.push('exclamation');
    if (content.match(/\b(love|like|enjoy|happy|sad|angry|afraid)\b/i)) {
      tags.push('emotional');
    }

    return tags;
  }

  /**
   * Calculate memory significance
   */
  private async calculateSignificance(content: string, role: MessageRole): Promise<number> {
    let significance = 0.5; // Base significance

    // Adjust based on role
    if (role === 'user') {
      significance += 0.2; // User messages are more significant
    }

    // Adjust based on content characteristics
    if (content.length > 100) {
      significance += 0.1; // Longer messages are more significant
    }

    if (content.includes('important') || content.includes('remember')) {
      significance += 0.3;
    }

    if (content.match(/\b(love|hate|amazing|terrible|wonderful|awful)\b/i)) {
      significance += 0.2; // Emotional content is more significant
    }

    if (content.includes('?')) {
      significance += 0.1; // Questions are somewhat more significant
    }

    // Ensure significance is between 0 and 1
    return Math.min(1, Math.max(0, significance));
  }

  /**
   * Extract emotional context from content
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
      // Simple emotion detection - could be enhanced
      const emotions: string[] = [];
      let intensity = 0.5;
      const confidence = 0.7;

      const emotionWords = {
        joy: ['happy', 'joyful', 'excited', 'delighted', 'cheerful'],
        sadness: ['sad', 'depressed', 'melancholy', 'sorrowful', 'gloomy'],
        anger: ['angry', 'furious', 'rage', 'irritated', 'annoyed'],
        fear: ['afraid', 'scared', 'terrified', 'anxious', 'worried'],
        surprise: ['surprised', 'amazed', 'astonished', 'shocked'],
        love: ['love', 'adore', 'cherish', 'affection', 'devoted'],
      };

      const lowerContent = content.toLowerCase();

      for (const [emotion, words] of Object.entries(emotionWords)) {
        for (const word of words) {
          if (lowerContent.includes(word)) {
            emotions.push(emotion);
            // Increase intensity based on strong words
            if (['furious', 'terrified', 'adore', 'amazing'].includes(word)) {
              intensity = Math.min(1, intensity + 0.3);
            }
            break;
          }
        }
      }

      if (emotions.length === 0) {
        return undefined;
      }

      return {
        emotions: [...new Set(emotions)],
        intensity,
        confidence,
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
   * Create an emotional state record from emotion analysis
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

    // Process primary emotions
    for (const emotion of emotionAnalysis.primaryEmotions) {
      const emotionType = await this.findOrCreateEmotionType(
        emotion.emotionName,
        emotion.intensity,
      );

      await this.prisma.emotionalStateComponent.create({
        data: {
          emotionalStateId: emotionalState.id,
          emotionTypeId: emotionType.id,
          intensity: emotion.intensity,
          voiceModulation: {
            detected_from: 'text_analysis',
            emotion_type: 'primary',
            content_preview: content.substring(0, 100),
          } as Prisma.InputJsonValue,
        },
      });
    }

    // Process secondary emotions
    for (const emotion of emotionAnalysis.secondaryEmotions) {
      const emotionType = await this.findOrCreateEmotionType(
        emotion.emotionName,
        emotion.intensity,
      );

      await this.prisma.emotionalStateComponent.create({
        data: {
          emotionalStateId: emotionalState.id,
          emotionTypeId: emotionType.id,
          intensity: emotion.intensity,
          voiceModulation: {
            detected_from: 'text_analysis',
            emotion_type: 'secondary',
            content_preview: content.substring(0, 100),
          } as Prisma.InputJsonValue,
        },
      });
    }

    return emotionalState.id;
  }

  /**
   * Find or create an emotion type
   */
  private async findOrCreateEmotionType(emotionName: string, intensity: number) {
    // Try to find existing emotion type
    let emotionType = await this.prisma.emotionType.findFirst({
      where: {
        emotionName: {
          equals: emotionName,
          mode: 'insensitive',
        },
      },
    });

    // Create if doesn't exist
    if (!emotionType) {
      emotionType = await this.prisma.emotionType.create({
        data: {
          primaryEmotion: this.categorizePrimaryEmotion(emotionName),
          intensityLevel: Math.round(intensity * 3) || 1, // Convert 0-1 to 1-3
          emotionName: emotionName,
          pleasureComponent: this.calculatePleasureComponent(emotionName),
          arousalComponent: this.calculateArousalComponent(emotionName),
          dominanceComponent: this.calculateDominanceComponent(emotionName),
        },
      });
    }

    return emotionType;
  }

  /**
   * Categorize emotion into primary emotion categories
   */
  private categorizePrimaryEmotion(emotionName: string): string {
    const emotionCategories: Record<string, string> = {
      joy: 'joy',
      happiness: 'joy',
      excitement: 'joy',
      love: 'trust',
      contentment: 'joy',
      sadness: 'sadness',
      anger: 'anger',
      fear: 'fear',
      anxiety: 'fear',
      disgust: 'disgust',
      surprise: 'surprise',
      anticipation: 'anticipation',
      trust: 'trust',
    };

    return emotionCategories[emotionName.toLowerCase()] || 'joy';
  }

  /**
   * Calculate PAD components for emotions
   */
  private calculatePleasureComponent(emotionName: string): number {
    const pleasureMap: Record<string, number> = {
      joy: 0.8,
      happiness: 0.8,
      excitement: 0.9,
      love: 0.9,
      contentment: 0.7,
      sadness: -0.7,
      anger: -0.5,
      fear: -0.8,
      anxiety: -0.6,
      disgust: -0.8,
      surprise: 0.1,
      anticipation: 0.3,
      trust: 0.5,
    };
    return pleasureMap[emotionName.toLowerCase()] || 0.0;
  }

  private calculateArousalComponent(emotionName: string): number {
    const arousalMap: Record<string, number> = {
      joy: 0.6,
      happiness: 0.5,
      excitement: 0.9,
      love: 0.7,
      contentment: 0.2,
      sadness: -0.4,
      anger: 0.8,
      fear: 0.7,
      anxiety: 0.6,
      disgust: 0.3,
      surprise: 0.8,
      anticipation: 0.5,
      trust: 0.1,
    };
    return arousalMap[emotionName.toLowerCase()] || 0.0;
  }

  private calculateDominanceComponent(emotionName: string): number {
    const dominanceMap: Record<string, number> = {
      joy: 0.5,
      happiness: 0.4,
      excitement: 0.6,
      love: 0.3,
      contentment: 0.3,
      sadness: -0.6,
      anger: 0.7,
      fear: -0.8,
      anxiety: -0.5,
      disgust: 0.2,
      surprise: -0.3,
      anticipation: 0.2,
      trust: 0.1,
    };
    return dominanceMap[emotionName.toLowerCase()] || 0.0;
  }

  /**
   * Create memory participant relationships
   */
  private async createMemoryParticipants(
    memoryId: string,
    participantNames: string[],
  ): Promise<void> {
    for (const participantName of participantNames) {
      // Find or create entity for participant
      const entity = await this.findOrCreateEntity(participantName);

      // Create memory participant relationship
      await this.prisma.memoryParticipant.create({
        data: {
          memoryId,
          entityId: entity.id,
          role: this.determineParticipantRole(participantName),
        },
      });
    }
  }

  /**
   * Find or create an entity for a participant
   */
  private async findOrCreateEntity(name: string) {
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
      entity = await this.prisma.entity.create({
        data: {
          name: normalizedName,
          entityType: this.determineEntityType(name),
          firstContactChannel: 'memory_formation',
          identificationMarkers: {
            source: 'extracted_from_content',
            original_form: name,
            normalized_form: normalizedName,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return entity;
  }

  /**
   * Determine entity type based on name patterns
   */
  private determineEntityType(name: string): 'human' | 'llm' | 'system' | 'unknown' {
    const lowerName = name.toLowerCase();

    // Check for pronouns and personal references - map persona to human since no persona type exists
    if (['i', 'me', 'myself', 'you', 'user', 'human'].includes(lowerName)) {
      return 'human';
    }

    if (lowerName.includes('gpt') || lowerName.includes('claude') || lowerName.includes('ai')) {
      return 'llm';
    }

    if (lowerName.includes('system') || lowerName.includes('bot')) {
      return 'system';
    }

    // Default to human for proper names
    return 'human';
  }

  /**
   * Determine participant role in memory
   */
  private determineParticipantRole(name: string): string {
    const lowerName = name.toLowerCase();

    if (['i', 'me', 'myself'].includes(lowerName)) {
      return 'primary';
    }

    if (['you', 'user'].includes(lowerName)) {
      return 'addressee';
    }

    // Check if it's a proper name (likely important participant)
    if (name.match(/^[A-Z][a-z]+$/)) {
      return 'participant';
    }

    return 'mentioned';
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
   * Detect emotions in text using LLM (integrated from emotion-detector service)
   */
  private async detectEmotions(text: string): Promise<EmotionAnalysis> {
    try {
      // Try cache first
      const cached = await this.promptCache.load('AnalyzeEmotions', text);
      let analysis: EmotionAnalysis;
      
      if (cached) {
        analysis = JSON.parse(cached.response) as EmotionAnalysis;
      } else {
        // Use BAML function to analyze emotions
        analysis = await b.AnalyzeEmotions(text);
        
        // Store in cache
        await this.promptCache.store('AnalyzeEmotions', text, analysis, undefined);
      }

      // Map detected emotions to database IDs
      const enrichedAnalysis = await this.enrichEmotionAnalysis(analysis);

      return enrichedAnalysis;
    } catch (error) {
      console.error('Error detecting emotions:', error);
      // Fallback to basic analysis
      return this.fallbackEmotionDetection(text);
    }
  }

  /**
   * Enrich emotion analysis with database IDs and create custom emotions if needed
   */
  private async enrichEmotionAnalysis(analysis: EmotionAnalysis): Promise<EmotionAnalysis> {
    // Process primary emotions
    for (const emotion of analysis.primaryEmotions) {
      await this.enrichDetectedEmotion(emotion);
    }

    // Process secondary emotions
    for (const emotion of analysis.secondaryEmotions) {
      await this.enrichDetectedEmotion(emotion);
    }

    // Register any custom emotions
    for (const customEmotionName of analysis.customEmotions) {
      await this.registerCustomEmotion(
        customEmotionName,
        analysis.padValues,
        '', // No context for custom emotions from analysis
      );
    }

    return analysis;
  }

  /**
   * Enrich a single detected emotion with database information
   */
  private async enrichDetectedEmotion(emotion: DetectedEmotion): Promise<void> {
    const dbEmotion = this.emotionCache.get(emotion.emotionName.toLowerCase());

    if (dbEmotion) {
      // Add database ID to the emotion object
      const emotionWithId = emotion as DetectedEmotionWithId;
      emotionWithId.emotionTypeId = dbEmotion.id.toString();
    } else if (emotion.isCustom) {
      // Create custom emotion in database
      const newEmotion = await this.registerCustomEmotion(
        emotion.emotionName,
        undefined, // Will estimate from context
        emotion.context || '',
      );
      const emotionWithId = emotion as DetectedEmotionWithId;
      emotionWithId.emotionTypeId = newEmotion.id.toString();
    }
  }

  /**
   * Create or update custom emotion types
   */
  private async registerCustomEmotion(
    emotionName: string,
    padValues?: PADValues,
    context?: string,
  ): Promise<EmotionType> {
    // Check if already exists
    const existing = await this.prisma.emotionType.findFirst({
      where: { emotionName },
    });

    if (existing) {
      return existing;
    }

    // Use provided PAD values or estimate from context
    const pad = padValues || (await this.estimatePADFromContext(emotionName, context || ''));

    // Create new emotion type
    const newEmotion = await this.prisma.emotionType.create({
      data: {
        primaryEmotion: 'custom',
        emotionName,
        intensityLevel: 2,
        pleasureComponent: pad.pleasure,
        arousalComponent: pad.arousal,
        dominanceComponent: pad.dominance,
      },
    });

    // Update cache
    this.emotionCache.set(emotionName.toLowerCase(), newEmotion);

    return newEmotion;
  }

  /**
   * Estimate PAD values using BAML
   */
  private async estimatePADFromContext(emotionName: string, context: string): Promise<PADValues> {
    try {
      const cacheKey = `${emotionName}|${context}`;
      const cached = await this.promptCache.load('EstimatePADValues', cacheKey);
      
      if (cached) {
        return JSON.parse(cached.response) as PADValues;
      }
      
      const result = await b.EstimatePADValues(emotionName, context);
      await this.promptCache.store('EstimatePADValues', cacheKey, result, undefined);
      return result;
    } catch (error) {
      console.error('Error estimating PAD values:', error);
      // Default neutral values
      return { pleasure: 0, arousal: 0.5, dominance: 0 };
    }
  }

  /**
   * Fallback emotion detection without LLM
   */
  private async fallbackEmotionDetection(text: string): Promise<EmotionAnalysis> {
    // Simple keyword-based detection as fallback
    const detectedEmotions: DetectedEmotion[] = [];

    // Check for basic emotions
    const emotionKeywords = {
      joy: /\b(happy|joy|glad|pleased|delighted|excited)\b/gi,
      sadness: /\b(sad|unhappy|depressed|down|crying)\b/gi,
      anger: /\b(angry|mad|furious|annoyed|irritated)\b/gi,
      fear: /\b(afraid|scared|frightened|worried|anxious)\b/gi,
      love: /\b(love|adore|cherish|devoted)\b/gi,
      arousal: /\b(aroused|desire|want|need|yearning)\b/gi,
    };

    for (const [emotion, pattern] of Object.entries(emotionKeywords)) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        detectedEmotions.push({
          emotionName: emotion,
          intensity: Math.min(1, matches.length * 0.3),
          confidence: 0.5,
          triggers: matches,
          isCustom: !this.emotionCache.has(emotion),
          context: null,
        });
      }
    }

    // Sort by intensity
    detectedEmotions.sort((a, b) => b.intensity - a.intensity);

    return {
      primaryEmotions: detectedEmotions.slice(0, 3),
      secondaryEmotions: detectedEmotions.slice(3),
      padValues: { pleasure: 0, arousal: 0.5, dominance: 0 },
      emotionalComplexity: Math.min(1, detectedEmotions.length / 5),
      compoundEmotions: [],
      customEmotions: [],
      transitions: [],
      metadata: {
        hasIntimateContent: /\b(intimate|romantic|sensual|aroused)\b/i.test(text),
        hasPhysicalResponse: /\b(trembling|shaking|breathless|flushed)\b/i.test(text),
        emotionalIntensity: detectedEmotions.length > 3 ? 'high' : 'medium',
      },
    };
  }
}
