// BAML functions for extracting personality observations from conversations
// Based on computational phenotyping approach - no hardcoded traits

class PersonalityContext {
  situation string? // What situation prompted this expression
  interactionPartner string? // Who they were interacting with
  emotionalState string? // Current emotional context
  trigger string? // What triggered this personality expression
}

class PersonalityObservation {
  traitDimension string // Discovered trait name (e.g., "openness_to_vulnerability", "emotional_expressiveness")
  observedValue float // Continuous value in trait space (normalized 0-1 or -1 to 1)
  confidence float // Confidence in this observation (0-1)
  
  // Context fields to match Prisma schema (no nested object)
  situation string? // What situation prompted this expression
  interactionPartner string? // Who they were interacting with (name/description)
  emotionalState string? // Current emotional context
  trigger string? // What triggered this personality expression
  
  evidence string[] // Direct quotes/behaviors supporting this observation
}

class StateDeviation {
  dimension string
  deviationMagnitude float // How far from typical behavior
  possibleCause string?
}

class EmergingPattern {
  pattern string // Described pattern
  frequency string // "increasing", "decreasing", "stable"
  contexts string[] // Contexts where pattern appears
}

class PersonalityObservationResult {
  observations PersonalityObservation[]
  stateDeviations StateDeviation[] // Meta-observations about personality dynamics
  emergingPatterns EmergingPattern[] // Emerging patterns (no thresholds, just observations)
}

function ExtractPersonalityObservations(content: string, recentHistory: string?) -> PersonalityObservationResult {
  client OpenRouterHaiku
  
  prompt #"
You are analyzing a conversation to extract personality observations using a computational phenotyping approach.

IMPORTANT: Do NOT use predefined personality traits or categories. Instead, discover and name traits based on what you observe in the conversation.

Current conversation:
{{ content }}

{% if recentHistory %}
Recent conversation history for context:
{{ recentHistory }}
{% endif %}

Return a PersonalityObservationResult with the following structure:

```json
{
  "observations": [
    {
      "traitDimension": "discovered_trait_name",
      "observedValue": 0.8,
      "confidence": 0.9,
      "situation": "describe the situation",
      "interactionPartner": "who they're with or null",
      "emotionalState": "their emotional state",
      "trigger": "what triggered this expression",
      "evidence": ["quote 1", "behavior 2"]
    }
  ],
  "stateDeviations": [
    {
      "dimension": "trait_dimension",
      "deviationMagnitude": 0.5,
      "possibleCause": "what might have caused this deviation"
    }
  ],
  "emergingPatterns": [
    {
      "pattern": "description of pattern",
      "frequency": "increasing/decreasing/stable",
      "contexts": ["context1", "context2"]
    }
  ]
}
```

Follow these principles:

1. **Discover Trait Dimensions**: Name traits based on observed behaviors, not predefined categories
   - Bad: "extraversion" (predefined)
   - Good: "enthusiasm_for_physical_intimacy", "vulnerability_in_expressing_needs"

2. **Continuous Values**: Use traitDimension and observedValue fields
   - Use 0-1 for intensity/presence (0=absent, 1=maximum)
   - Use -1 to 1 for bipolar traits (e.g., -1=hiding, 1=revealing)

3. **Context Matters**: Fill in situation, interactionPartner, emotionalState, and trigger fields

4. **Evidence-Based**: Provide specific quotes/behaviors in the evidence array

5. **Track Deviations**: Note when behavior seems different from typical patterns

6. **Emergent Patterns**: Identify recurring behavioral patterns without judging them

Remember: We're mapping this person's unique personality space, not fitting them into boxes.
"#
}

// Function to analyze personality dynamics over time using PersDyn model concepts
class CurrentStateAnalysis {
  observedValue float
  distanceFromTypical float? // If we have enough history
  returningToBaseline bool? // Is behavior moving back to typical?
}

class VariabilityPattern {
  recentRange float? // Range of values in recent observations
  contextsWithHighVariation string[] // Situations causing more variation
  contextsWithLowVariation string[] // Situations with stable behavior
}

class EventTriggeredChange {
  event string
  impactMagnitude float
  persistenceDuration string? // "brief", "lasting", "unknown"
}

class TemporalDynamics {
  trend string? // "increasing", "decreasing", "oscillating", "stable"
  cyclicalPatterns string? // Any noticed cycles
  eventTriggeredChanges EventTriggeredChange[]
}

class PersonalityDynamicsAnalysis {
  traitDimension string
  currentState CurrentStateAnalysis // Current state analysis (not parameters, just observations)
  variabilityPattern VariabilityPattern // Variability observations
  temporalDynamics TemporalDynamics // Temporal patterns
}

function AnalyzePersonalityDynamics(
  recentObservations: PersonalityObservation[],
  historicalContext: string?
) -> PersonalityDynamicsAnalysis[] {
  client OpenRouterHaiku
  
  prompt #"
Analyze personality dynamics from recent observations, looking for patterns of change and stability.

Recent observations:
{{ recentObservations }}

{% if historicalContext %}
Historical context:
{{ historicalContext }}
{% endif %}

For each trait dimension observed, analyze:

1. **Current State**: Where is this trait now compared to their typical expression?

2. **Variability Patterns**: 
   - How much does this trait vary?
   - What contexts increase/decrease variation?

3. **Temporal Dynamics**:
   - Is there a trend over time?
   - Do you see cyclical patterns?
   - What events trigger changes and how persistent are they?

Focus on describing patterns, not making judgments. We're mapping the natural dynamics of their personality expression.
"#
}