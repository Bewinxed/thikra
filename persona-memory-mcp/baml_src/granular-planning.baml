// Granular Approach Planning
// LLM-driven decision making for which tools to use and in what order

function PlanGranularProcessing(content: string, context: GranularContext) -> GranularPlan {
  client OpenRouterHaiku
  prompt #"
    You are an intelligent agent deciding how to process a message using granular persona memory tools.
    
    Available Tools:
    - storeMemory: Create a memory from the message
    - extractPersonaInsights: Extract personality traits, identity, desires, etc.
    - searchMemories: Find related memories for context
    - setPersonaState: Update dynamic emotional/mental states
    - getSemanticContext: Find related emotions, relationships, personality traits
    - updateRelationship: Process relationship dynamics (if entities mentioned)
    
    Message: "{{ content }}"
    
    Context:
    - Persona ID: {{ context.personaId }}
    - Has previous memories: {{ context.hasMemories }}
    - Recent emotional state: {{ context.recentEmotionalState }}
    - Known entities: {{ context.knownEntities }}
    - Message complexity: {{ context.complexity }}
    
    Plan the optimal sequence of tool usage based on:
    1. Message content and emotional significance
    2. What information would be most valuable to capture
    3. How to build context and associations
    4. Efficiency vs comprehensiveness trade-offs
    
    IMPORTANT: Be strategic and adaptive. Not every message needs every tool.
    Focus on what would provide the most value for this specific content.
  "#
}

function DecideNextAction(
  currentPlan: GranularPlan,
  completedActions: string[],
  intermediateResults: ActionResult[]
) -> NextActionDecision {
  client OpenRouterHaiku
  prompt #"
    You are continuing to execute a granular processing plan. Based on what's been done
    and the results so far, decide what to do next.
    
    Original Plan: {{ currentPlan }}
    Completed Actions: {{ completedActions }}
    Results So Far: {{ intermediateResults }}
    
    Should you:
    1. Continue with the next planned action
    2. Adapt the plan based on new insights
    3. Add additional processing steps
    4. Skip remaining steps (if sufficient)
    5. Complete processing
    
    Be intelligent about resource usage vs information gain.
  "#
}

function EvaluateGranularResults(
  actions: ActionResult[],
  originalMessage: string,
  processingTime: int
) -> GranularEvaluation {
  client OpenRouterHaiku
  prompt #"
    Evaluate the effectiveness of this granular processing approach.
    
    Original Message: "{{ originalMessage }}"
    Actions Taken: {{ actions }}
    Total Processing Time: {{ processingTime }}ms
    
    Assess:
    1. Comprehensiveness - did we capture the important aspects?
    2. Efficiency - was the tool usage optimal?
    3. Quality - are the results accurate and meaningful?
    4. Missed Opportunities - what could have been done better?
    
    Provide insights for improving future granular processing.
  "#
}

// Data structures for granular planning

class GranularContext {
  personaId string
  hasMemories bool
  recentEmotionalState string?
  knownEntities string[]
  complexity string
}

class GranularPlan {
  // Ordered list of tool actions to take
  plannedActions ToolAction[]
  // Reasoning for this plan
  strategy string
  // Expected processing time
  estimatedTime int
  // What we hope to achieve
  objectives string[]
}

class ToolAction {
  // Tool name to call
  tool string
  // Parameters for the tool
  parameters ToolParameters
  // Why this action is needed
  reasoning string
  // Priority level
  priority string // "critical", "important", "optional"
}

class ToolParameters {
  // Flexible parameters based on tool
  content string?
  personaId string?
  extractionType string?
  query string?
  stateKey string?
  stateValue string?
  maxResults int?
}

class NextActionDecision {
  // What to do next
  decision string // "continue", "adapt", "add_action", "skip", "complete"
  // If adapting, the new action
  newAction ToolAction?
  // If skipping, which actions to skip
  actionsToSkip string[]
  // Reasoning for the decision
  reasoning string
}

class ActionResult {
  tool string
  success bool
  duration int
  dataChanged bool
  insights string[]
  errors string[]
}

class GranularEvaluation {
  comprehensivenessScore float // 0.0 to 1.0
  efficiencyScore float // 0.0 to 1.0
  qualityScore float // 0.0 to 1.0
  overallRating float // 0.0 to 1.0
  strengths string[]
  weaknesses string[]
  suggestions string[]
}