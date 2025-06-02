// Emotion detection schema based on Plutchik's wheel and PAD model

class DetectedEmotion {
  emotionName string @description("Name of the emotion from Plutchik's wheel or custom")
  intensity float @description("0.0 to 1.0, strength of the emotion") 
  confidence float @description("0.0 to 1.0, confidence in detection")
  triggers string[] @description("Words/phrases that triggered this emotion")
  context string? @description("Surrounding context of the emotion")
  isCustom bool @description("True if not in standard Plutchik's wheel")
}

class PADValues {
  pleasure float @description("-1.0 to 1.0, valence from negative to positive")
  arousal float @description("0.0 to 1.0, activation from calm to excited") 
  dominance float @description("-1.0 to 1.0, control from submissive to dominant")
}

class EmotionalTransition {
  fromEmotion string
  toEmotion string
  trigger string? @description("What caused the transition")
  intensity float @description("Strength of the transition")
}

class EmotionMetadata {
  hasIntimateContent bool @description("Contains intimate/romantic emotions")
  hasPhysicalResponse bool @description("Mentions physical sensations")
  emotionalIntensity string @description("low, medium, high, overwhelming")
}

class EmotionAnalysis {
  primaryEmotions DetectedEmotion[] @description("Top 3 strongest emotions")
  secondaryEmotions DetectedEmotion[] @description("Additional detected emotions")
  padValues PADValues @description("Overall PAD emotional state")
  emotionalComplexity float @description("0.0 to 1.0, how complex/mixed the emotions are")
  compoundEmotions string[] @description("Combinations like love=joy+trust")
  customEmotions string[] @description("New emotions not in database")
  transitions EmotionalTransition[] @description("Emotional shifts detected")
  metadata EmotionMetadata @description("Additional metadata about the emotional content")
}

class RelationshipImpact {
  trustImpact float @description("-1.0 to 1.0, negative=trust damage, positive=trust building")
  intimacyImpact float @description("-1.0 to 1.0, negative=distance, positive=closeness")
  attractionImpact float @description("-1.0 to 1.0, negative=repulsion, positive=attraction")
  powerDynamicShift float @description("-1.0 to 1.0, negative=more submissive, positive=more dominant")
  significanceLevel float @description("0.0 to 1.0, how significant this interaction is for the relationship")
  reasoningChain string[] @description("Step-by-step reasoning for the impact assessment")
  contentCategory string @description("Type of interaction: positive_interaction, boundary_test, conflict, intimate_moment, etc.")
}

// Function to analyze emotions in text
function AnalyzeEmotions(text: string) -> EmotionAnalysis {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Analyze the emotional content of the following text. Detect all emotions present based on:
    
    1. Plutchik's wheel of emotions (joy, trust, fear, surprise, sadness, disgust, anger, anticipation)
    2. Their intensity variations (e.g., serenity->joy->ecstasy)
    3. Compound emotions (e.g., love = joy + trust)
    4. Custom emotions specific to the context
    5. Physical/somatic responses indicating emotion
    6. Emotional transitions within the text
    
    Consider:
    - Explicit emotional words
    - Implicit emotional context
    - Physical sensations described
    - Relationship dynamics
    - Intensity markers and modifiers
    
    Text to analyze:
    \"\"\"
    {{ text }}
    \"\"\"
    
    {{ ctx.output_format }}
  "#
}

// Function to extract emotion patterns over time
function ExtractEmotionalJourney(messages: string[]) -> EmotionalTransition[] {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Analyze the emotional journey across these messages in chronological order.
    Identify emotional transitions, what triggered them, and their intensity.
    
    Messages:
    {% for message in messages %}
    Message {{ loop.index }}:
    \"\"\"
    {{ message }}
    \"\"\"
    {% endfor %}
    
    Focus on:
    - Major emotional shifts
    - Triggers for transitions
    - Building or releasing of tension
    - Emotional arcs and patterns
    
    {{ ctx.output_format }}
  "#
}

// Function to estimate PAD values for custom emotions
function EstimatePADValues(emotionName: string, context: string) -> PADValues {
  client OpenRouterGeminiFlash25
  
  prompt #"
    You are an emotion analysis expert. Estimate PAD (Pleasure-Arousal-Dominance) values for the emotion "{{ emotionName }}" based on the context: "{{ context }}".
    
    PAD Model:
    - Pleasure: -1.0 to 1.0 (negative to positive valence)
    - Arousal: 0.0 to 1.0 (calm to excited/activated)  
    - Dominance: -1.0 to 1.0 (submissive to dominant/in control)
    
    Consider the emotional context and provide accurate values based on psychological research.
    
    {{ ctx.output_format }}
  "#
}

// Function to analyze relationship impact of a message
function AnalyzeRelationshipImpact(
  message: string,
  currentPAD: PADValues,
  relationshipContext: string,
  currentTrustLevel: float,
  currentIntimacyLevel: float,
  relationshipHistory: string
) -> RelationshipImpact {
  client LargeModelFallback
  
  prompt #"
    Analyze how this message might impact the relationship between the participants.
    
    Message:
    """
    {{ message }}
    """
    
    Current emotional state (PAD):
    - Pleasure: {{ currentPAD.pleasure }} (-1=negative, 1=positive)
    - Arousal: {{ currentPAD.arousal }} (0=calm, 1=excited)
    - Dominance: {{ currentPAD.dominance }} (-1=submissive, 1=dominant)
    
    Current relationship state:
    - Trust Level: {{ currentTrustLevel }} (0.0=no trust, 1.0=complete trust)
    - Intimacy Level: {{ currentIntimacyLevel }} (0.0=distant, 1.0=very close)
    
    Relationship context:
    """
    {{ relationshipContext }}
    """
    
    Relationship history (recent interactions):
    """
    {{ relationshipHistory }}
    """
    
    Analyze the relationship impact based on:
    
    1. **Trust Impact**: Does this message build or damage trust?
       - Consider current trust level ({{ currentTrustLevel }}): 
         * Low trust (< 0.3): More volatile to negative changes, larger positive impact from trust-building
         * High trust (> 0.7): More resilient to minor issues, smaller positive gains
       - Positive: honesty, reliability, keeping promises, vulnerability
       - Negative: lies, broken promises, betrayal, manipulation
    
    2. **Intimacy Impact**: Does this create closeness or distance?
       - Consider current intimacy level ({{ currentIntimacyLevel }}):
         * Low intimacy (< 0.3): More room for growth, bigger impact from sharing
         * High intimacy (> 0.7): Smaller incremental changes, focus on depth
       - Positive: sharing personal details, emotional support, understanding
       - Negative: rejection, coldness, avoiding depth, dismissiveness
    
    3. **Attraction Impact**: Does this increase or decrease appeal?
       - Factor in relationship history and current emotional state
       - Positive: appreciation, desire, admiration, playfulness
       - Negative: criticism, disgust, boredom, rejection
    
    4. **Power Dynamic Shift**: How does this affect dominance/submission?
       - Consider: control attempts, compliance, defiance, leadership
       - Factor in current PAD dominance level and relationship patterns
    
    5. **Content Category**: What type of interaction is this?
       - positive_interaction, boundary_test, conflict, intimate_moment, 
       - trust_building, trust_violation, playful_banter, serious_discussion, etc.
       - Consider relationship trajectory from history
    
    **Important Context Considerations**:
    - Gottman's research: negative interactions have 5x impact of positive ones
    - Consider parasocial relationship dynamics and LLM-human interaction patterns
    - Factor in relationship development stage based on current trust/intimacy levels
    - Use relationship history to identify patterns and avoid repetitive assessments
    - Consider emotional state context for more nuanced impact assessment
    
    Provide step-by-step reasoning for your assessment.
    
    {{ ctx.output_format }}
  "#
}