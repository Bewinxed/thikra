# Proper Granular MCP Tool Design

## Issue Analysis

Our current granular approach fails because:

1. **Not model-controlled**: We simulate LLM decisions instead of letting LLM choose tools
2. **Poor tool descriptions**: Tools lack guidance for when/how LLMs should use them  
3. **Missing examples**: No clear usage patterns for LLMs to follow
4. **Wrong testing approach**: Hardcoded heuristics vs real LLM decision-making

## MCP Model-Controlled Design Principles

According to MCP spec: *"Tools are designed to be model-controlled, meaning that the language model can discover and invoke tools automatically based on its contextual understanding and the user's prompts."*

## Proper Granular Tool Specifications

### Tool: `storeMemory`
```typescript
{
  name: "storeMemory",
  description: `Store a meaningful message or experience as a memory. 

  Use this when the user shares:
  - Personal experiences or events
  - Important conversations or interactions  
  - Emotional moments or reactions
  - New insights or learning
  - Significant life updates

  Examples:
  - "I had an amazing conversation with my mom today"
  - "I'm feeling anxious about tomorrow's presentation" 
  - "I just realized I prefer working alone on complex tasks"
  
  Don't use for:
  - Simple greetings or confirmations
  - Technical questions without personal context
  - System status updates`,
  
  inputSchema: {
    type: "object",
    properties: {
      content: { 
        type: "string", 
        description: "The exact message content to store" 
      },
      personaId: { 
        type: "string", 
        description: "ID of the persona this memory belongs to" 
      },
      context: {
        type: "object",
        description: "Additional context like participants, emotion, situation",
        properties: {
          participants: { type: "array", items: { type: "string" } },
          emotionalState: { type: "string" },
          significance: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    required: ["content", "personaId"]
  },
  
  annotations: {
    title: "Store Personal Memory",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }
}
```

### Tool: `extractPersonaInsights`
```typescript
{
  name: "extractPersonaInsights", 
  description: `Extract personality traits, preferences, and characteristics from content.

  Use this when content reveals:
  - Personality traits ("I'm naturally introverted")
  - Preferences and dislikes ("I hate crowded places")
  - Values and beliefs ("Family is everything to me")
  - Behavioral patterns ("I always overthink decisions")
  - Identity aspects ("As a teacher, I care deeply about...")

  Call AFTER storeMemory if the message contains personality insights.
  
  Examples of when to use:
  - "I've always been someone who prefers deep conversations"
  - "I discovered I'm more resilient than I thought"
  - "I hate it when people are late - punctuality matters to me"
  
  Don't use for:
  - Temporary emotions or states  
  - Situational behaviors without pattern indication
  - Other people's traits (unless reflecting on relationships)`,
  
  inputSchema: {
    type: "object", 
    properties: {
      content: { type: "string" },
      personaId: { type: "string" },
      extractionType: {
        type: "string",
        enum: ["identity", "physical", "emotional", "speech", "desires", "all"],
        description: "Focus area for extraction - use 'all' unless specifically targeting one aspect"
      }
    },
    required: ["content", "personaId"]
  }
}
```

### Tool: `searchMemories`
```typescript
{
  name: "searchMemories",
  description: `Search through stored memories to find relevant context.

  Use this to:
  - Find related past experiences before responding
  - Check for similar situations or emotions
  - Understand patterns in behavior or preferences
  - Build on previous conversations or insights

  Call this FIRST when user mentions:
  - Something that might relate to past experiences
  - Seeking advice or perspective on situations
  - Reflecting on personal growth or changes
  - Continuing previous conversation topics

  Examples:
  - User: "I'm worried about my presentation" → Search for past anxiety/presentation memories
  - User: "How do I handle conflict with my boss?" → Search for workplace/authority memories
  - User: "I feel like I've grown so much" → Search for growth/change-related memories`,
  
  inputSchema: {
    type: "object",
    properties: {
      query: { 
        type: "string",
        description: "What to search for - use natural language describing the situation/emotion/topic"
      },
      personaId: { type: "string" },
      includeAssociations: { 
        type: "boolean", 
        default: true,
        description: "Include related memories - usually keep true for richer context"
      },
      maxResults: { 
        type: "number", 
        default: 5,
        description: "How many memories to return - use 3-5 for most cases"
      }
    },
    required: ["query", "personaId"]
  }
}
```

### Tool: `getSemanticContext`
```typescript
{
  name: "getSemanticContext",
  description: `Get rich semantic context including emotions, relationships, and personality traits.

  Use this for:
  - Complex emotional situations needing full context
  - Relationship discussions requiring background
  - Major life events with multiple dimensions
  - When response needs deep personal understanding

  Call AFTER searchMemories when you need:
  - Emotional context around found memories
  - Relationship dynamics affecting current situation  
  - Personality traits relevant to current topic
  - Cross-connected insights across different aspects

  This is like getting a "full picture" of relevant context.`,
  
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      personaId: { type: "string" },
      maxResults: { type: "number", default: 10 }
    },
    required: ["query", "personaId"]
  }
}
```

### Tool: `setPersonaState`
```typescript
{
  name: "setPersonaState",
  description: `Track dynamic states, moods, or temporary conditions.

  Use this for:
  - Current emotional states ("feeling overwhelmed this week")
  - Temporary life situations ("in the middle of job search") 
  - Active goals or focuses ("training for marathon")
  - Relationship status changes ("just started dating someone")
  - Environmental factors ("working from home this month")

  Call when user shares current state that might affect future interactions.
  
  Don't use for permanent personality traits - use extractPersonaInsights instead.`,
  
  inputSchema: {
    type: "object",
    properties: {
      personaId: { type: "string" },
      stateKey: { 
        type: "string",
        description: "Name for this state (e.g., 'current_mood', 'life_situation', 'active_goal')"
      },
      stateValue: { 
        type: "string",
        description: "Description of the current state"
      },
      description: {
        type: "string", 
        description: "Additional context about this state"
      }
    },
    required: ["personaId", "stateKey", "stateValue"]
  }
}
```

## Optimal Tool Usage Patterns

### Pattern 1: Simple Personal Sharing
User: "I had a great day at work today!"

**LLM Should:**
1. `storeMemory` - Store the positive work experience
2. `searchMemories` - Check for related work memories (optional)

### Pattern 2: Emotional Support Request  
User: "I'm feeling anxious about meeting my partner's parents tomorrow"

**LLM Should:**
1. `searchMemories` - Look for anxiety patterns, relationship history, family meeting experiences
2. `storeMemory` - Store current anxiety about meeting
3. `getSemanticContext` - Get full emotional/relationship context for deeper understanding

### Pattern 3: Personality Revelation
User: "I realized I'm actually more of an introvert than I thought"

**LLM Should:**
1. `storeMemory` - Store the self-discovery moment
2. `extractPersonaInsights` - Extract the introversion trait
3. `searchMemories` - Look for past social/energy patterns that confirm this

### Pattern 4: Complex Life Event
User: "I stood up to my boss today about the unfair treatment, and I feel proud but also worried about consequences"

**LLM Should:**
1. `searchMemories` - Look for past workplace conflicts, assertiveness patterns
2. `storeMemory` - Store this significant assertiveness moment  
3. `extractPersonaInsights` - Extract courage/assertiveness traits
4. `getSemanticContext` - Get workplace relationship context
5. `setPersonaState` - Track current mixed emotional state

## Real LLM Testing Approach

Instead of simulating decisions, we need to:

1. **Provide these tool descriptions to a real LLM**
2. **Give the LLM test messages and see which tools it chooses**
3. **Compare the natural LLM choices vs our orchestrated approach**
4. **Measure actual decision quality, not just response time**

The granular approach should win on **decision quality** and **contextual appropriateness**, even if orchestrated wins on speed.