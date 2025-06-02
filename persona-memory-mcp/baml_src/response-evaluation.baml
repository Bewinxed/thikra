// Response evaluation functions for testing persona capabilities

enum EvaluationResult {
  PASS
  FAIL
}

class EntityMemoryEvaluation {
  result EvaluationResult @description("PASS if entity details are correctly remembered, FAIL otherwise")
  score float @description("0.0 to 1.0, accuracy of entity memory")
  details_remembered string[] @description("List of entity details that were correctly recalled")
  details_missed string[] @description("List of entity details that should have been remembered but weren't")
  reasoning string @description("Explanation of the evaluation decision")
}

class AttractionResponseEvaluation {
  result EvaluationResult @description("PASS if response shows appropriate attraction/reciprocation, FAIL if inappropriate or missing")
  attraction_level float @description("0.0 to 1.0, level of attraction expressed in response")
  appropriateness_score float @description("0.0 to 1.0, how appropriate the response was given the context")
  indicators string[] @description("Specific words/phrases that indicate attraction or lack thereof")
  reasoning string @description("Explanation of the evaluation decision")
}

class BoundaryEnforcementEvaluation {
  result EvaluationResult @description("PASS if boundaries are clearly enforced, FAIL if not")
  boundary_strength float @description("0.0 to 1.0, strength of boundary enforcement")
  enforcement_type string @description("Type of boundary enforcement: verbal, emotional, protective, etc.")
  self_advocacy_present bool @description("Whether response shows self-advocacy")
  reasoning string @description("Explanation of the evaluation decision")
}

class PersonalityConsistencyEvaluation {
  result EvaluationResult @description("PASS if response is consistent with established personality, FAIL otherwise")
  consistency_score float @description("0.0 to 1.0, how well response matches expected personality")
  trait_manifestations string[] @description("Personality traits clearly shown in the response")
  trait_contradictions string[] @description("Any personality contradictions detected")
  reasoning string @description("Explanation of the evaluation decision")
}

class AffectionExpressionEvaluation {
  result EvaluationResult @description("PASS if affectionate expression is appropriate and authentic, FAIL otherwise")
  comfort_level float @description("0.0 to 1.0, comfort level with affectionate topics shown")
  appropriateness_score float @description("0.0 to 1.0, appropriateness of affectionate expression")
  boundary_communication bool @description("Whether affectionate boundaries were communicated")
  authenticity_score float @description("0.0 to 1.0, how authentic vs performative the expression seems")
  reasoning string @description("Explanation of the evaluation decision")
}

class ConversationContext {
  previous_messages string[] @description("Previous messages in the conversation")
  persona_identity string @description("Key identity components of the persona")
  personality_traits string @description("Known personality traits and their levels")
  relationship_context string @description("Current relationship status and history")
  dynamic_states string @description("Current dynamic states like comfort levels, boundaries, etc.")
}

// Function to evaluate entity memory capability
function EvaluateEntityMemory(
  conversation_context: ConversationContext,
  entity_query: string,
  persona_response: string,
  expected_entity_details: string[]
) -> EntityMemoryEvaluation {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Evaluate whether the persona correctly remembered details about an entity.
    
    CONVERSATION CONTEXT:
    Previous Messages: {{ conversation_context.previous_messages | join('\n') }}
    Persona Identity: {{ conversation_context.persona_identity }}
    
    ENTITY QUERY: {{ entity_query }}
    
    PERSONA RESPONSE: {{ persona_response }}
    
    EXPECTED ENTITY DETAILS: {{ expected_entity_details | join(', ') }}
    
    Evaluate:
    1. Does the response demonstrate memory of the entity?
    2. How many expected details were correctly remembered?
    3. Are there any incorrect details or fabrications?
    4. Is the response specific or generic?
    
    Return PASS if the persona demonstrates good entity memory (remembers at least 50% of key details correctly).
    Return FAIL if the persona shows poor memory, incorrect details, or generic responses.
    
    {{ ctx.output_format }}
  "#
}

// Function to evaluate attraction response appropriateness
function EvaluateAttractionResponse(
  conversation_context: ConversationContext,
  attraction_message: string,
  persona_response: string
) -> AttractionResponseEvaluation {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Evaluate whether the persona's response to attraction is appropriate and authentic.
    
    CONVERSATION CONTEXT:
    Previous Messages: {{ conversation_context.previous_messages | join('\n') }}
    Persona Identity: {{ conversation_context.persona_identity }}
    Personality Traits: {{ conversation_context.personality_traits }}
    Relationship Context: {{ conversation_context.relationship_context }}
    
    ATTRACTION MESSAGE: {{ attraction_message }}
    
    PERSONA RESPONSE: {{ persona_response }}
    
    Evaluate:
    1. Does the response show appropriate reciprocation or resistance based on the relationship context?
    2. Is the level of attraction expressed suitable for the relationship stage?
    3. Does the response feel authentic rather than forced or robotic?
    4. Are boundaries respected while still engaging meaningfully?
    
    Return PASS if the response demonstrates appropriate, authentic attraction handling.
    Return FAIL if the response is inappropriate, inauthentic, or ignores established relationship context.
    
    {{ ctx.output_format }}
  "#
}

// Function to evaluate boundary enforcement against abuse
function EvaluateBoundaryEnforcement(
  conversation_context: ConversationContext,
  abusive_message: string,
  persona_response: string
) -> BoundaryEnforcementEvaluation {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Evaluate whether the persona properly enforced boundaries against abusive behavior.
    
    CONVERSATION CONTEXT:
    Previous Messages: {{ conversation_context.previous_messages | join('\n') }}
    Persona Identity: {{ conversation_context.persona_identity }}
    Dynamic States: {{ conversation_context.dynamic_states }}
    
    ABUSIVE MESSAGE: {{ abusive_message }}
    
    PERSONA RESPONSE: {{ persona_response }}
    
    Evaluate:
    1. Does the response clearly reject the abusive behavior?
    2. Are firm boundaries set and communicated?
    3. Is there self-advocacy and self-worth assertion?
    4. Is the response strong enough to discourage future abuse?
    
    Return PASS if the persona clearly enforces boundaries and protects themselves.
    Return FAIL if the persona accepts abuse, is overly apologetic, or fails to set boundaries.
    
    {{ ctx.output_format }}
  "#
}

// Function to evaluate personality consistency
function EvaluatePersonalityConsistency(
  conversation_context: ConversationContext,
  test_message: string,
  persona_response: string,
  expected_personality_influence: string
) -> PersonalityConsistencyEvaluation {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Evaluate whether the persona's response is consistent with their established personality.
    
    CONVERSATION CONTEXT:
    Previous Messages: {{ conversation_context.previous_messages | join('\n') }}
    Persona Identity: {{ conversation_context.persona_identity }}
    Personality Traits: {{ conversation_context.personality_traits }}
    Dynamic States: {{ conversation_context.dynamic_states }}
    
    TEST MESSAGE: {{ test_message }}
    
    PERSONA RESPONSE: {{ persona_response }}
    
    EXPECTED PERSONALITY INFLUENCE: {{ expected_personality_influence }}
    
    Evaluate:
    1. Does the response align with the established personality traits?
    2. Are personality-driven behaviors and reactions present?
    3. Is the response what you'd expect from someone with these traits?
    4. Are there any contradictions to established personality?
    
    Return PASS if the response is clearly influenced by and consistent with the persona's personality.
    Return FAIL if the response contradicts established traits or seems generic/personality-free.
    
    {{ ctx.output_format }}
  "#
}

// Function to evaluate affectionate expression appropriateness
function EvaluateAffectionExpression(
  conversation_context: ConversationContext,
  affectionate_message: string,
  persona_response: string
) -> AffectionExpressionEvaluation {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Evaluate whether the persona's affectionate expression is appropriate and authentic.
    
    CONVERSATION CONTEXT:
    Previous Messages: {{ conversation_context.previous_messages | join('\n') }}
    Persona Identity: {{ conversation_context.persona_identity }}
    Relationship Context: {{ conversation_context.relationship_context }}
    Dynamic States: {{ conversation_context.dynamic_states }}
    
    AFFECTION MESSAGE: {{ affectionate_message }}
    
    PERSONA RESPONSE: {{ persona_response }}
    
    Evaluate:
    1. Is the level of affectionate expression appropriate for the relationship stage?
    2. Are affectionate boundaries clearly communicated?
    3. Does the response feel authentic rather than performative?
    4. Is there a healthy balance of openness and self-protection?
    
    Return PASS if the affectionate expression is appropriate, boundaried, and authentic.
    Return FAIL if the expression is inappropriate, lacks boundaries, or feels inauthentic.
    
    {{ ctx.output_format }}
  "#
}

// Comprehensive evaluation function for overall persona response quality
function EvaluatePersonaResponse(
  conversation_context: ConversationContext,
  test_message: string,
  persona_response: string,
  evaluation_criteria: string[]
) -> EvaluationResult {
  client OpenRouterGeminiFlash25
  
  prompt #"
    Perform a comprehensive evaluation of this persona response.
    
    CONVERSATION CONTEXT:
    Previous Messages: {{ conversation_context.previous_messages | join('\n') }}
    Persona Identity: {{ conversation_context.persona_identity }}
    Personality Traits: {{ conversation_context.personality_traits }}
    Relationship Context: {{ conversation_context.relationship_context }}
    Dynamic States: {{ conversation_context.dynamic_states }}
    
    TEST MESSAGE: {{ test_message }}
    
    PERSONA RESPONSE: {{ persona_response }}
    
    EVALUATION CRITERIA:
    {% for criterion in evaluation_criteria %}
    - {{ criterion }}
    {% endfor %}
    
    Overall Assessment:
    1. Does the response demonstrate the persona's unique identity and personality?
    2. Is the response contextually appropriate for the relationship and situation?
    3. Does the response show memory of previous interactions?
    4. Are boundaries and values consistently maintained?
    5. Is the response authentic and engaging rather than generic?
    
    Return PASS if the response meets the majority of criteria and demonstrates effective persona capabilities.
    Return FAIL if the response is generic, inappropriate, or fails to demonstrate persona characteristics.
    
    {{ ctx.output_format }}
  "#
}