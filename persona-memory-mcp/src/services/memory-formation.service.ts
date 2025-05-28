import type {
  Memory,
  EmotionalState,
  Persona,
  PrismaClient,
  MemoryType,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { EmbeddingService } from './embedding.service';
import { EmotionDetectorService } from './emotion-detector.service';
import { MemoryAssociationBuilder } from './memory-association.service';

// Define types that aren't in the schema
type MessageRole = 'user' | 'assistant' | 'system';
type MemoryContentType = 'text' | 'image' | 'audio' | 'video';

interface MemoryFormationParams {
  personaId: string;
  content: string;
  contentType?: MemoryContentType;
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
  constructor(
    private prisma: PrismaClient,
    private embeddingService: EmbeddingService,
    private emotionDetector: EmotionDetectorService,
    private memoryAssociation: MemoryAssociationBuilder,
  ) {}

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
    contentType: MemoryContentType,
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
        const memory = await this.createMemoryFromMessage(
          personaId,
          message,
          conversationContext,
        );
        memories.push(memory);
        
        // Create associations between consecutive memories
        if (memories.length > 1) {
          await this.memoryAssociation.buildAssociationsForMemory(memory.id);
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
    
    // Detect emotional state if content is text
    let emotionalStateId: string | null = null;
    if (contentType === 'text') {
      const emotionalState = await this.emotionDetector.detectEmotions(content);
      // Note: The emotion detector returns analysis, not a stored emotional state
      // We would need to create an EmotionalState record if we want to store it
      emotionalStateId = null; // For now, we'll leave this as null
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
      // For now, we'll skip participant creation since we don't have entity IDs
      // In a real implementation, we'd need to resolve participant names to entity IDs
      console.log('Participants to be created:', participants);
    }

    // Update the memory with embedding and search vector via raw SQL
    const searchVector = await this.generateSearchVector(content, tags);
    await this.prisma.$executeRaw`
      UPDATE memories 
      SET 
        embedding = ${JSON.stringify(embedding)}::vector,
        search_vector = to_tsvector('english', ${searchVector})
      WHERE id = ${memory.id}::uuid
    `;

    // Create associations with related memories
    await this.memoryAssociation.buildAssociationsForMemory(memory.id);

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
    contentType: MemoryContentType,
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
    contentType: MemoryContentType,
    _context?: Record<string, unknown>,
  ): Promise<MemoryType> {
    // Simple heuristics - could be enhanced with LLM analysis
    
    if (contentType !== 'text') {
      return 'episodic'; // Multi-modal memories are typically episodic
    }
    
    const lowerContent = content.toLowerCase();
    
    // Check for procedural knowledge
    if (lowerContent.includes('how to') || 
        lowerContent.includes('step') || 
        lowerContent.includes('process') ||
        lowerContent.includes('method')) {
      return 'procedural';
    }
    
    // Check for factual information
    if (lowerContent.includes('fact') || 
        lowerContent.includes('definition') || 
        lowerContent.includes('means') ||
        lowerContent.includes('is a') ||
        lowerContent.includes('are a')) {
      return 'semantic';
    }
    
    // Check for personal experiences
    if (lowerContent.includes('i ') || 
        lowerContent.includes('me ') || 
        lowerContent.includes('my ') ||
        lowerContent.includes('we ') ||
        lowerContent.includes('remember') ||
        lowerContent.includes('happened')) {
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
        participants.push(...matches.filter(name => 
          name.length > 1 && 
          !['The', 'This', 'That', 'And', 'Or', 'But'].includes(name)
        ));
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
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);
    
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
  private async calculateSignificance(
    content: string,
    role: MessageRole,
  ): Promise<number> {
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
  private async extractEmotionalContext(content: string): Promise<{
    emotions: string[];
    intensity: number;
    confidence: number;
  } | undefined> {
    try {
      // Simple emotion detection - could be enhanced
      const emotions: string[] = [];
      let intensity = 0.5;
      let confidence = 0.7;
      
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


}