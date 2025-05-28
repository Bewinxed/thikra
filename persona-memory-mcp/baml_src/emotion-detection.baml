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

// Function to analyze emotions in text
function AnalyzeEmotions(text: string) -> EmotionAnalysis {
  client OpenRouterGPT4o
  
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
  client OpenRouterGPT4o
  
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
  client OpenRouterHaiku
  
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