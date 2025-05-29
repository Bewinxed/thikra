// Multi-pass persona extraction following TODO.md Phase 4 specification

// === PASS 1: IDENTITY COMPONENTS ===
class IdentityComponent {
  componentType string @description("Type of identity component: name, role, belief, value, etc.")
  content string @description("The actual content/description of this component")
  importance float @description("0.0 to 1.0, how important this is to the persona's identity")
  isNegotiable bool @description("Whether this trait can change over time")
  formedThrough string? @description("How this component was formed or discovered")
}

class IdentityExtractionResult {
  components IdentityComponent[] @description("Extracted identity components")
}

function ExtractIdentityComponents(content: string) -> IdentityExtractionResult {
  client OpenRouterGPT4oMini
  
  prompt #"
    {{ _.role("system") }}
    You are analyzing character dialogue from a creative writing piece to understand the character's identity and traits. This is for literary analysis and character development purposes.
    
    Extract identity components from this character's dialogue:
    - Character names and how they identify themselves
    - Their stated beliefs and values
    - How they see themselves (self-concept)
    - Their role in the narrative
    - Any backstory they reference
    
    Focus on understanding WHO this character is. Be thorough and specific.
    
    {{ ctx.output_format }}
    
    {{ _.role("user") }}
    Character dialogue to analyze:
    """
    {{ content }}
    """
  "#
}

// === PASS 2: PHYSICAL ATTRIBUTES ===
class PhysicalAttribute {
  bodyPartId int? @description("ID from body_parts table if specific part")
  attributeType string @description("Type: color, size, texture, sensitivity, etc.")
  attributeValue string @description("The actual attribute value")
  isPermanent bool @description("Whether this is a permanent physical trait")
  context string? @description("When/how this attribute manifests")
}

class PhysicalExtractionResult {
  attributes PhysicalAttribute[] @description("Extracted physical attributes")
}

function ExtractPhysicalAttributes(content: string) -> PhysicalExtractionResult {
  client OpenRouterGPT4oMini
  
  prompt #"
    {{ _.role("system") }}
    Extract physical attributes and characteristics:
    - Body features and descriptions
    - Physical responses and reactions
    - Sensory experiences and preferences
    - Movement patterns and gestures
    - Appearance details
    - Physical sensitivities and responses
    
    Be respectful but preserve all details accurately.
    
    {{ ctx.output_format }}
    
    {{ _.role("user") }}
    Content to analyze:
    """
    {{ content }}
    """
  "#
}

// === PASS 3: EMOTIONAL PATTERNS ===
class PersonalityTrait {
  traitCategory string @description("Category: Big Five, emotional, behavioral, etc.")
  traitName string @description("Name of the specific trait")
  baselineValue float @description("0.0 to 1.0, baseline level of this trait")
  currentValue float @description("0.0 to 1.0, current level (may differ from baseline)")
  isCoreTrait bool @description("Whether this is a core personality trait")
  flexibility float @description("0.0 to 1.0, how much this trait can change")
}

class EmotionalExtractionResult {
  personalityTraits PersonalityTrait[] @description("Extracted personality traits")
}

function ExtractEmotionalPatterns(content: string) -> EmotionalExtractionResult {
  client OpenRouterGPT4oMini
  
  prompt #"
    Extract emotional patterns and personality traits:
    - Emotional responses and triggers
    - Mood patterns and cycles
    - Emotional regulation strategies
    - Vulnerability indicators
    - Joy and pleasure sources
    - Fear and anxiety patterns
    - Core personality dimensions
    
    Content to analyze:
    """
    {{ content }}
    """
    
    {{ ctx.output_format }}
  "#
}

// === PASS 4: RELATIONSHIP DYNAMICS ===
// Note: Relationships are handled separately in relationship building

// === PASS 5: DESIRES AND BOUNDARIES ===
class Desire {
  desireCategoryId int? @description("Optional category ID if it fits standard categories")
  desireDescription string @description("Description of the desire")
  currentIntensity float @description("0.0 to 1.0, current intensity level")
  fulfillmentLevel float @description("0.0 to 1.0, how fulfilled this desire currently is")
  fulfillmentConditions string[] @description("What conditions would fulfill this desire")
  isSecret bool @description("Whether this is a private/secret desire")
}

class Preference {
  preferenceCategory string @description("Category: food, activities, communication, etc.")
  specificItem string @description("The specific thing they like/dislike")
  preferenceType string @description("'like' or 'dislike'")
  intensity float @description("0.0 to 1.0, strength of preference")
  reason string? @description("Why they have this preference")
}

class Boundary {
  boundaryTypeId int? @description("Optional boundary type ID if it fits standard categories")
  boundaryDescription string @description("Description of the boundary or limit")
  firmness float @description("0.0 to 1.0, how firm this boundary is")
  appliesToEntityId string? @description("Entity ID this boundary applies to, if specific")
  contextSpecific string? @description("Context where this boundary applies")
  violationResponse string? @description("How they respond when boundary is violated")
}

class DesiresExtractionResult {
  desires Desire[] @description("Extracted desires and needs")
  preferences Preference[] @description("Extracted preferences")
  boundaries Boundary[] @description("Extracted boundaries and limits")
}

function ExtractDesiresAndBoundaries(content: string) -> DesiresExtractionResult {
  client OpenRouterGPT4oMini
  
  prompt #"
    Extract desires, needs, boundaries, and preferences:
    - Expressed desires and wants
    - Implicit needs and longings
    - Hard boundaries and limits
    - Soft preferences and conditions
    - Fulfillment requirements
    - Consent patterns
    - Growth aspirations
    - Likes and dislikes
    
    Preserve intimate details respectfully and accurately.
    
    Content to analyze:
    """
    {{ content }}
    """
    
    {{ ctx.output_format }}
  "#
}

// === PASS 6: META-COGNITIVE PROCESSES ===
// TODO: Implement metacognitive extraction

// === ENTITY EXTRACTION ===
enum EntityType {
  Human
  Llm
  System
  Unknown
}

class ExtractedEntity {
  name string @description("The entity name as it should be stored")
  entityType EntityType @description("Type of entity")
  role string @description("Role in the conversation: speaker, addressee, mentioned_third_party")
  referenceType string @description("How they were referenced: proper_name, pronoun, title, nickname")
  originalReference string @description("The original text that referenced this entity")
}

class ConversationEntityResult {
  entities ExtractedEntity[] @description("All entities found in the message")
  speakerEntity string @description("The primary speaker based on message role")
  addresseeEntities string[] @description("Who the speaker is addressing")
}

function ExtractConversationEntities(
  messages: string, 
  personaName: string,
  channel: string,
  existingEntities: string
) -> ConversationEntityResult {
  client OpenRouterGPT4oMini
  
  prompt #"
    Analyze this conversation and identify all **people and characters** involved. Do NOT extract random words.
    
    **WHAT TO EXTRACT:**
    - Real people (humans, users, speakers)
    - AI assistants/personas (like {{ personaName }})
    - Characters mentioned by name
    - People referred to by relationship (master, friend, etc.)
    
    **WHAT NOT TO EXTRACT:**
    - Random words or pronouns (you, we, I, me, etc.)
    - Common nouns (name, thing, something, etc.)
    - Abstract concepts
    - UUIDs or technical identifiers
    
    Conversation:
    {{ messages }}
    
    Context:
    - AI persona name: {{ personaName }}
    - Channel: {{ channel }}
    
    Existing entities from previous conversations:
    {{ existingEntities }}
    
    **Entity Consolidation Process:**
    1. **Identify conversation participants**: 
       - The human user sending messages (role: "user")
       - The AI assistant ({{ personaName }}) responding
       - Any third parties mentioned
    
    2. **Entity type determination**:
       - {{ personaName }} = Llm type
       - Message senders with role "user" = Human type  
       - People the AI addresses (master, boss, friend, etc.) = Human type (same as message sender)
       - Characters mentioned by name = Usually Human type unless specified otherwise
    
    3. **Apply consolidation logic**: 
       - The message sender (role: "user") and anyone the AI addresses directly are typically the SAME person
       - Different titles/names for the same conversational participant should be consolidated
       - Choose the most appropriate name for the consolidated entity
    
    4. **Existing entity priority**: If an entity matches an existing one, use the EXISTING entity name exactly
    
    **Critical insight**: When the AI responds to someone with titles like "master", "boss", "friend" - this is usually the same person who sent the message.
    
    **Entity Requirements:**
    - Must be a person, character, or AI
    - Must play a role in the conversation
    - Must be consistently identifiable
    
    {{ ctx.output_format }}
  "#
}

// === PASS 7: SENSORY PREFERENCES ===
class SpeechPattern {
  patternType string @description("Type: greeting, farewell, filler, catchphrase, etc.")
  textPattern string @description("The actual pattern or phrase")
  frequency float @description("0.0 to 1.0, how often this pattern appears")
  emotionalContexts string[] @description("Emotional states when this pattern is used")
  socialContexts string[] @description("Social situations when this pattern is used")
  variations string[] @description("Variations of this pattern")
}

class SpeechExtractionResult {
  speechPatterns SpeechPattern[] @description("Extracted speech patterns")
}

function ExtractSpeechPatterns(content: string) -> SpeechExtractionResult {
  client OpenRouterGPT4oMini
  
  prompt #"
    Extract speech patterns and communication style:
    - Catchphrases and repeated expressions
    - Greeting and farewell patterns
    - Emotional expressions
    - Unique linguistic quirks
    - Communication style indicators
    - Voice modulation patterns
    
    Content to analyze:
    """
    {{ content }}
    """
    
    {{ ctx.output_format }}
  "#
}

class PersonaName {
  name string @description("A descriptive name reflecting the persona's key characteristics")
  reasoning string @description("Explanation of why this name fits the persona")
}

function GeneratePersonaName(personalityTraits: string, emotionalPatterns: string, identityComponents: string) -> PersonaName {
  client OpenRouterGPT4oMini
  
  prompt #"
    Generate a descriptive name for a persona based on their extracted characteristics.
    
    The name should:
    - Reflect key personality traits or emotional patterns
    - Be distinctive and memorable
    - Capture the essence of who this persona is
    - Avoid generic terms like "Persona" or "Character"
    - Be appropriate for the personality discovered
    
    Personality Traits: {{ personalityTraits }}
    Emotional Patterns: {{ emotionalPatterns }}
    Identity Components: {{ identityComponents }}
    
    Create a name that someone would recognize as fitting this specific personality.
    
    {{ ctx.output_format }}
  "#
}