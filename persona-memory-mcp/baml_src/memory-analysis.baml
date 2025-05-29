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
  client OpenRouterGPT4oMini
  
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
  client OpenRouterGPT4oMini
  
  prompt #"
    Assess the significance of this content for memory formation.
    
    Consider:
    - Emotional intensity and impact
    - Personal relevance and meaning  
    - Uniqueness or memorability
    - Relationship importance
    - Life-changing or defining moments
    - Learning or growth opportunities
    
    Content: {{ content }}
    Speaker Role: {{ speakerRole }}
    Context: {{ context }}
    
    Provide a nuanced assessment based on psychological principles of memory formation.
    
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
  client OpenRouterGPT4oMini
  
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
  client OpenRouterGPT4oMini
  
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
  client OpenRouterGPT4oMini
  
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
  client OpenRouterGPT4oMini
  
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
  client OpenRouterGPT4oMini
  
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