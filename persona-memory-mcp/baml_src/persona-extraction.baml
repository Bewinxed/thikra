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
  client OpenRouterHaiku
  
  prompt #"
    {{ _.role("system", cache_control={"type": "ephemeral"}) }}
    Extract identity components from this content. Look for:
    - Names, aliases, self-identifications
    - Core beliefs and values
    - Self-concept and identity markers
    - Roles and responsibilities
    - Personal history references
    
    Focus on WHO this persona is at their core. Be specific and preserve intimate details.
    
    {{ ctx.output_format }}
    
    {{ _.role("user") }}
    Content to analyze:
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
  client OpenRouterHaiku
  
  prompt #"
    {{ _.role("system", cache_control={"type": "ephemeral"}) }}
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
  client OpenRouterHaiku
  
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

class DesiresExtractionResult {
  desires Desire[] @description("Extracted desires and needs")
  preferences Preference[] @description("Extracted preferences")
}

function ExtractDesiresAndBoundaries(content: string) -> DesiresExtractionResult {
  client OpenRouterHaiku
  
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
  client OpenRouterHaiku
  
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