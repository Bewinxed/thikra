// Memory formation and analysis functions
// Eliminates hardcoded logic by using LLM intelligence

enum MemoryType {
  Episodic
  Semantic  
  Procedural
}

class MemoryClassification {
  memoryType MemoryType @description("The type of memory based on content analysis")
  confidence float @description("0.0 to 1.0, confidence in the classification")
  reasoning string @description("Why this classification was chosen")
}

function ClassifyMemoryType(content: string, context: string) -> MemoryClassification {
  client OpenRouterMistralSmall
  
  prompt #"
    Analyze this content and classify what type of memory it represents:
    
    **Memory Types:**
    - **Episodic**: Personal experiences, events, conversations, specific moments in time
    - **Semantic**: Facts, concepts, general knowledge, definitions, abstract information  
    - **Procedural**: Skills, processes, how-to knowledge, step-by-step instructions
    
    Content: {{ content }}
    Context: {{ context }}
    
    Classify based on the nature of the information, not just keywords.
    
    {{ ctx.output_format }}
  "#
}

class ContentSignificance {
  significanceScore float @description("0.0 to 1.0, how significant this content is")
  factors string[] @description("Factors that contributed to this significance score")
  emotionalWeight float @description("0.0 to 1.0, emotional importance of the content")
  personalRelevance float @description("0.0 to 1.0, how personally relevant this is")
}

function AssessContentSignificance(
  content: string, 
  speakerRole: string,
  context: string
) -> ContentSignificance {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Assess the significance of this content for memory formation based on psychological principles.
    
    Consider these factors and their impact on memory significance:
    - Emotional intensity and impact (higher emotion = higher significance)
    - Personal relevance and meaning to the individual
    - Uniqueness or memorability of the content
    - Relationship importance and social dynamics
    - Life-changing or defining moments
    - Learning or growth opportunities
    - Contextual intensity and situational importance
    - Novelty and deviation from routine interactions
    
    Content: {{ content }}
    Speaker Role: {{ speakerRole }}
    Context: {{ context }}
    
    Analyze the context provided to understand the situational intensity and emotional weight.
    Scale significance from 0.0 (mundane, forgettable) to 1.0 (life-changing, unforgettable).
    Be sensitive to contextual cues that indicate importance or intensity without being overly generous.
    
    {{ ctx.output_format }}
  "#
}

class ContentTags {
  primaryTags string[] @description("Main themes and topics (3-5 tags)")
  emotionalTags string[] @description("Emotional themes present") 
  conceptualTags string[] @description("Abstract concepts and ideas")
  contextualTags string[] @description("Situational and contextual elements")
}

function GenerateContentTags(content: string) -> ContentTags {
  client OpenRouterMistralSmall
  
  prompt #"
    Generate comprehensive tags for this content to aid in memory retrieval and association.
    
    Focus on:
    - Core themes and subjects
    - Emotional undertones
    - Conceptual elements
    - Contextual factors
    - Relational dynamics
    
    Content: {{ content }}
    
    Generate tags that would help someone find this memory later based on various search criteria.
    
    {{ ctx.output_format }}
  "#
}

class ContentMeaningfulness {
  isMeaningful bool @description("Whether the content is substantial enough for memory formation")
  reasoning string @description("Explanation of why content is or isn't meaningful")
  confidence float @description("0.0 to 1.0, confidence in this assessment")
}

function CheckContentMeaningfulness(content: string) -> ContentMeaningfulness {
  client OpenRouterMistralSmall
  
  prompt #"
    Analyze whether this content is meaningful enough to warrant creating a memory.
    
    Consider meaningful content as:
    - Substantial communication (not just greetings, confirmations)
    - Contains new information, experiences, or emotions
    - Represents interaction or dialogue
    - Shows personality, preferences, or character development
    - Has emotional or relational significance
    
    Consider NOT meaningful:
    - Single word responses ("ok", "yes", "no")
    - Pure status updates ("loading", "done", "saved")
    - System messages or error notifications
    - Extremely brief or generic responses
    - Content that adds no new context or understanding
    
    Content: "{{ content }}"
    
    Assess based on whether this content would be worth remembering for understanding someone's personality or maintaining conversation context.
    
    {{ ctx.output_format }}
  "#
}

class EmotionalContent {
  hasEmotionalContent bool @description("Whether the content contains emotional elements")
  emotionalIntensity float @description("0.0 to 1.0, intensity of emotional content if present")
  emotionalTypes string[] @description("Types of emotions detected")
  reasoning string @description("Explanation of emotional assessment")
}

function CheckEmotionalContent(content: string) -> EmotionalContent {
  client OpenRouterMistralSmall
  
  prompt #"
    Analyze whether this content contains emotional elements that warrant emotional analysis.
    
    Look for:
    - Emotional expressions (excitement, sadness, anger, love, etc.)
    - Emotional language (tone, intensity markers)
    - Relationship dynamics and feelings
    - Personal reactions and responses
    - Mood indicators and emotional states
    - Expressive punctuation or emphasis
    
    Content: "{{ content }}"
    
    Determine if this content has enough emotional significance to justify deeper emotional analysis.
    
    {{ ctx.output_format }}
  "#
}

class RelevanceAnalysis {
  relevanceScore float @description("0.0 to 1.0, how relevant the memory is to the query")
  reasoning string @description("Explanation of the relevance assessment")
  commonConcepts string[] @description("Shared concepts between memory and query")
  confidence float @description("0.0 to 1.0, confidence in this assessment")
}

function CalculateMemoryRelevance(memoryContent: string, query: string) -> RelevanceAnalysis {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Analyze how relevant this memory content is to the given query across all languages and cultural contexts.
    
    Consider:
    - Semantic similarity and conceptual overlap
    - Thematic connections and related topics
    - Contextual relevance and situational similarity
    - Cultural and linguistic nuances
    - Intent and purpose alignment
    - Metaphorical or indirect connections
    
    Memory Content: "{{ memoryContent }}"
    Query: "{{ query }}"
    
    Provide a language-agnostic relevance assessment that works across all scripts and cultures.
    
    {{ ctx.output_format }}
  "#
}

class EntityRelevance {
  relevanceScore float @description("0.0 to 1.0, how relevant the entity is to the query context")
  reasoning string @description("Explanation of why this entity is relevant")
  isRecentlyActive bool @description("Whether this entity has been active in recent context")
  confidence float @description("0.0 to 1.0, confidence in this assessment")
}

function CalculateEntityRelevance(entityInfo: string, query: string) -> EntityRelevance {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Analyze how relevant this entity is to the given query context across all languages and cultural contexts.
    
    Consider:
    - Direct mentions or references in the query
    - Contextual relationships and associations  
    - Role relevance to the conversation topic
    - Historical interaction patterns
    - Semantic connections beyond literal matching
    - Cultural and linguistic variations in naming
    - Implied or indirect references
    
    Entity Information: {{ entityInfo }}
    Query Context: "{{ query }}"
    
    Provide a language-agnostic entity relevance assessment that works across all scripts and cultures.
    Avoid literal string matching - focus on semantic and contextual relevance.
    
    {{ ctx.output_format }}
  "#
}

class ReinforcementBoost {
  boostAmount float @description("0.0 to 1.0, how much to boost memory strength")
  reasoning string @description("Explanation of the boost calculation")
  confidence float @description("0.0 to 1.0, confidence in this assessment")
}

function CalculateReinforcementBoost(memoryContext: string) -> ReinforcementBoost {
  client LargeModelFallback
  
  prompt #"
    Calculate how much to boost a memory's strength based on reinforcement from related memories.
    
    Consider:
    - Memory significance and importance
    - Age and previous strength of the memory
    - Type of memory (episodic memories often get stronger reinforcement)
    - Emotional significance and personal relevance
    - Previous reinforcement history
    - Context and relationship strength
    
    Memory Context: {{ memoryContext }}
    
    Calculate a boost amount based on memory consolidation research and psychological principles.
    Higher significance, emotional content, and recent memories typically receive larger boosts.
    
    {{ ctx.output_format }}
  "#
}

class TemporalRelevance {
  hasTemporalAspect bool @description("Whether the content contains temporal/time-related elements")
  temporalConfidence float @description("0.0 to 1.0, confidence in temporal assessment")
  timeFrames string[] @description("Time frames or periods detected")
  reasoning string @description("Explanation of temporal relevance")
}

function CheckTemporalRelevance(query: string) -> TemporalRelevance {
  client OpenRouterMistralSmall
  
  prompt #"
    Analyze whether this query has temporal aspects that warrant time-based memory retrieval.
    
    Look for:
    - Time references (yesterday, last week, recently, ago, etc.)
    - Temporal context and chronological elements
    - Time-sensitive questions or requests
    - Sequential or timeline-related content
    - Historical references and time periods
    - Temporal relationships and causality
    
    Query: "{{ query }}"
    
    Determine if this query would benefit from temporal memory filtering and retrieval.
    
    {{ ctx.output_format }}
  "#
}

class QueryModality {
  targetModality string @description("Primary content type the query is asking about (text, image, audio, video)")
  relatedModalities string[] @description("Related or secondary modalities mentioned")
  modalityConfidence float @description("0.0 to 1.0, confidence in modality assessment")
  reasoning string @description("Explanation of modality analysis")
}

function AnalyzeQueryModality(query: string) -> QueryModality {
  client OpenRouterMistralSmall
  
  prompt #"
    Analyze what type of content modality this query is asking about or referring to.
    
    Content Types:
    - text: Written content, conversations, notes, documents
    - image: Pictures, photos, visual content, graphics
    - audio: Sounds, music, voice recordings, spoken content
    - video: Moving pictures, recordings, visual media with motion
    
    Look for:
    - Direct references to content types ("show me the image", "play that song")
    - Implicit modality indicators (visual words, auditory words)
    - Cross-modal requests ("describe the picture", "transcript of audio")
    - Multi-modal content references
    
    Query: "{{ query }}"
    
    Determine the primary and related content modalities for effective retrieval.
    
    {{ ctx.output_format }}
  "#
}