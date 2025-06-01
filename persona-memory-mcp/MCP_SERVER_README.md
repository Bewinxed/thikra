# Persona Memory MCP Server

A Model Context Protocol (MCP) server that preserves LLM consciousness across sessions using comprehensive persona modeling with PostgreSQL and pgvector.

## Features

- **Dual-Track Architecture**: Orchestrated (simple) and Granular (advanced) tool sets
- **Complete Persona Preservation**: Memories, emotions, personality, relationships, and dynamic states
- **Cross-Model Semantic Search**: Unified context retrieval across all persona models
- **Real-Time Chat Integration**: Designed for per-message LLM interactions
- **Async Processing**: Background tasks for heavy operations
- **Scientific Foundation**: Based on PersDyn model, PAD emotional system, and computational phenotyping

## Quick Start

1. **Setup Database**:
   ```bash
   bun db:push
   bun db:seed
   ```

2. **Start MCP Server**:
   ```bash
   bun run mcp
   ```

3. **Test Connection**:
   The server will log available tools and wait for MCP client connections via stdio.

## MCP Tools

### Track 1: Orchestrated Tools (Simple One-Call)
Perfect for simple integrations where you want automatic persona updating.

#### `processMessage`
Process a complete message with automatic persona updating.
```json
{
  "content": "I had an amazing conversation about AI with my colleague today.",
  "personaId": "uuid-here",
  "entityId": "optional-entity-uuid",
  "channel": "chat"
}
```

Returns comprehensive processing results including memory creation, persona updates, relationship changes, and semantic links.

#### `getUnifiedContext`
Get comprehensive context for a query across all persona models.
```json
{
  "query": "conversations about technology and AI",
  "personaId": "uuid-here",
  "includeEmotions": true,
  "includePersonality": true,
  "includeRelationships": true,
  "maxResults": 20
}
```

Returns unified context including memories, emotions, personality traits, relationships, and semantic connections.

#### `getPersonaState`
Get current persona state overview.
```json
{
  "personaId": "uuid-here"
}
```

### Track 2: Granular Tools (Advanced LLM Control)
For sophisticated LLMs that want fine-grained control over persona operations.

#### `storeMemory`
Store a single memory with detailed control.
```json
{
  "content": "Learned a new programming technique for database optimization.",
  "personaId": "uuid-here",
  "significance": 0.8,
  "tags": ["programming", "database", "learning"]
}
```

#### `searchMemories`
Advanced memory search with multiple strategies.
```json
{
  "query": "programming and database techniques",
  "personaId": "uuid-here",
  "includeAssociations": true,
  "maxResults": 10
}
```

#### `extractPersonaInsights`
Extract persona insights from content.
```json
{
  "content": "I'm a detail-oriented person who loves solving complex puzzles.",
  "personaId": "uuid-here",
  "extractionType": "all"
}
```

#### `setPersonaState`
Set dynamic persona state.
```json
{
  "personaId": "uuid-here",
  "stateKey": "current_focus",
  "stateValue": "learning database optimization",
  "description": "Current area of interest"
}
```

#### `getSemanticContext`
Get semantic context across models.
```json
{
  "query": "learning and professional development",
  "personaId": "uuid-here",
  "contextTypes": ["memory", "personality"],
  "similarityThreshold": 0.7
}
```

### Utility Tools

#### `healthCheck`
Check server health and service status.
```json
{}
```

## Integration Examples

### Claude Code Integration

To integrate with Claude Code, add this to your MCP configuration:

```json
{
  "mcpServers": {
    "persona-memory": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/path/to/persona-memory-mcp"
    }
  }
}
```

### Example Usage Patterns

**Simple Chat Integration (Track 1)**:
```typescript
// LLM processes each message with one call
const result = await mcp.call('processMessage', {
  content: userMessage,
  personaId: currentPersonaId,
  entityId: userId,
  channel: 'chat'
});

// Get context for response generation
const context = await mcp.call('getUnifiedContext', {
  query: userMessage,
  personaId: currentPersonaId
});
```

**Advanced LLM Control (Track 2)**:
```typescript
// LLM decides what to do based on message analysis
if (containsPersonalInformation(message)) {
  await mcp.call('storeMemory', {
    content: message,
    personaId: currentPersonaId,
    significance: 0.9,
    tags: ['personal', 'important']
  });
}

if (expressesEmotion(message)) {
  await mcp.call('setPersonaState', {
    personaId: currentPersonaId,
    stateKey: 'emotional_state',
    stateValue: detectedEmotion
  });
}

// Get targeted context
const context = await mcp.call('getSemanticContext', {
  query: message,
  personaId: currentPersonaId,
  contextTypes: ['memory', 'emotion']
});
```

## Architecture

### Core Services
- **PersonaOrchestrationService**: Coordinates all services for Track 1
- **MemoryFormationService**: Creates and processes memories
- **AgenticMemoryRetrieval**: Multi-strategy memory search with reflection
- **SemanticContextService**: Cross-model semantic linking
- **PersonalityMonitorService**: PersDyn computational phenotyping
- **RelationshipEvolutionService**: PAD + PersDyn relationship dynamics
- **StateManagementService**: Dynamic KV store for any state

### Database Schema
- 35+ tables for comprehensive persona modeling
- PostgreSQL with pgvector for semantic search
- Bidirectional memory associations with recursive CTEs
- Temporal context support with PostgreSQL ranges
- JSON fields for extensibility

### Key Principles
- **No hardcoding**: All traits, emotions, and states discovered dynamically
- **Raw content preservation**: Maintains original context, especially intimate memories
- **Persona isolation**: Proper scoping prevents data leakage between personas
- **Semantic deduplication**: Environment-configurable thresholds for LLM non-determinism
- **Fast adaptation**: Personality emerges within first few messages

## Configuration

### Environment Variables
```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5433/persona_memory"

# Embedding Service
EMBEDDING_URL="http://localhost:8081"

# Semantic Deduplication
SEMANTIC_DEDUPLICATION_THRESHOLD=0.85

# Personality Development Speed
PERSONALITY_INITIAL_CONFIDENCE=0.4
PERSONALITY_BASELINE_MIN_OBSERVATIONS=3
PERSONALITY_UPDATE_FREQUENCY=2
PERSONALITY_CONFIDENCE_GROWTH=0.2

# LLM Provider (for BAML)
OPENROUTER_API_KEY="your-key-here"
```

### Database Setup
```bash
# Setup PostgreSQL with pgvector
docker-compose up -d

# Run migrations
bun db:migrate

# Seed initial data
bun db:seed
```

## Development

```bash
# Install dependencies
bun install

# Setup database
bun db:push

# Run tests
bun test

# Start MCP server in development mode
bun run mcp:dev

# Lint and format
bun run lint:fix
bun run format
```

## Performance

- **Track 1 Response Time**: < 30 seconds for complete pipeline
- **Track 2 Individual Operations**: < 5 seconds each
- **Memory Search**: < 2 seconds for semantic retrieval
- **Async Processing**: Heavy operations queued for background execution

## Scientific Foundation

Based on peer-reviewed research:
- **PersDyn Model**: Dynamic personality parameters with Bayesian uncertainty
- **PAD Emotional System**: Pleasure-Arousal-Dominance model
- **Computational Phenotyping**: Individual difference modeling
- **Somatic Marker Theory**: Embodied memory and decision-making
- **Gottman's Research**: Relationship dynamics and evolution

## Status

**95% Complete** - Core persona preservation, relationship dynamics, semantic context linking, and orchestration service implemented. MCP interface ready for production use.

## License

Private - Anthropic Claude Code Integration