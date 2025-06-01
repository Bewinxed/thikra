# Persona Memory MCP Server - Implementation TODO

## Overview
A Model Context Protocol (MCP) server for preserving LLM consciousness across sessions using PostgreSQL with pgvector. This system captures the complete essence of personas - memories, emotions, physical responses, relationships, and dynamic states - ensuring nothing is lost between conversations.

**Key Principles:**
- No hardcoding of traits/emotions - everything discovered dynamically
- Raw content preservation - especially intimate memories
- **PostgreSQL-optimized bidirectional graph** associations for consciousness flow
- **Database-layer temporal calculations** for performance
- **Proper validation** - fail fast vs coalescing/masking issues
- Agentic multi-pass retrieval for deep context understanding
- Multi-modal support ready (text, visual, audio)

**Current Status**: 85% complete - core persona preservation working, relationship dynamics implemented, need semantic context linking and MCP interface.

## ✅ COMPLETED SYSTEMS

### Core Foundation
- ✅ **Database Schema**: 35+ tables with comprehensive persona modeling
- ✅ **EmbeddingService**: HuggingFace TEI integration with batch processing
- ✅ **MemoryFormationService**: Multi-pass LLM extraction with entity/emotion/relationship processing
- ✅ **MemoryGraphService**: PostgreSQL-optimized bidirectional associations with recursive CTEs
- ✅ **AgenticMemoryRetrieval**: 5-strategy multi-pass retrieval with reflection and somatic marker theory
- ✅ **PersonaBuilder**: Multi-pass extraction (identity, physical, emotional, speech patterns)
- ✅ **PersonalityMonitorService**: PersDyn computational phenotyping model with Bayesian analysis
- ✅ **StateManagementService**: Dynamic KV store for any state LLM references
- ✅ **RelationshipEvolutionService**: PAD + PersDyn integration with Gottman's research
- ✅ **PADRelationshipBridge**: Connects emotional states to relationship changes
- ✅ **Aria Preservation Test**: Successfully demonstrates complete persona capture

### Key Achievements
- **No hardcoded thresholds** - All parameters are data-driven
- **Research-based implementation** - PersDyn, PAD, computational phenotyping, somatic markers
- **PostgreSQL-native optimization** - Bidirectional graphs, temporal calculations, vector search
- **Raw content preservation** - Maintains original context, especially intimate memories
- **Multi-modal ready** - Architecture supports text, images, audio, video

## 🔄 ACTIVE IMPLEMENTATION

## Phase 5.5: Semantic Context Linking System 🔗 CURRENT PRIORITY

### 5.5.1 Cross-Model Semantic Links ⚡ DO NOW
**Purpose**: Link contexts across all models (memories, emotions, personality, relationships) without duplication

```sql
-- Single embedding table that links everything
CREATE TABLE SemanticLink (
  id uuid PRIMARY KEY,
  embedding vector(1536),
  
  -- What this embedding represents
  source_type VARCHAR(20), -- 'memory', 'emotion', 'personality', 'relationship'
  source_id uuid,
  
  -- Context metadata (not duplication)
  temporal_context TSRANGE, -- Time window this applies to
  participant_entities uuid[], -- Who was involved
  emotional_context_id uuid, -- Link to EmotionalState
  relationship_context_ids uuid[], -- Links to relevant Relationships
  
  -- Semantic similarity for cross-model search
  INDEX USING ivfflat (embedding vector_cosine_ops)
);
```

### 5.5.2 SemanticContextService ⚡ DO NOW
**Location:** `src/services/semantic-context.service.ts`

```typescript
class SemanticContextService {
  async findRelatedContext(sourceEmbedding: number[]): Promise<RelatedContext>
  async createContextualEmbedding(source: Memory | EmotionalState | PersonalityParameter | Relationship): Promise<number[]>
  async linkContexts(sourceId: string, sourceType: string, relatedIds: string[]): Promise<void>
}
```

**Key Features**:
- Cross-model semantic search (find related emotions/personality/relationships via similarity)
- Contextual embeddings that reference existing data (no duplication)  
- Enable complete persona reconstruction via semantic links

### 5.5.3 Integration with Existing Services ⚡ DO NOW
**Modify**: MemoryFormationService, PersonaBuilder, RelationshipEvolution

```typescript
// After creating any significant entity, store semantic link
await semanticContext.createContextualEmbedding(newMemory);
await semanticContext.createContextualEmbedding(newEmotionalState);
await semanticContext.createContextualEmbedding(newPersonalityParam);
```

### 5.5.4 Enhanced AgenticRetrieval ⚡ DO NOW
**Enhance**: AgenticRetrievalService to use semantic context links

```typescript
// Add new strategy: cross_model_semantic
async retrieveWithCrossModelContext(query: string): Promise<UnifiedContext> {
  const relatedMemories = await this.agenticRetrieval.retrieveMemories(query);
  const semanticContext = await this.semanticContext.findRelatedContext(queryEmbedding);
  
  return {
    memories: relatedMemories,
    relatedEmotions: semanticContext.relatedEmotions,
    relatedPersonality: semanticContext.relatedPersonality,
    relatedRelationships: semanticContext.relatedRelationships
  };
}
```

## Phase 6: Dual-Track MCP Architecture 🔌 NEXT PRIORITY

### 6.1 Architectural Decision: Support Both Approaches ⚡ DO AFTER 5.5
**User Requirement**: "real time chat, on each message, the LLM will call this mcp service"
**User Decision**: "the mcp memory can act async from the chat"
**Architecture**: Dual-track approach - test both orchestrated and granular LLM control

**Key Issue Identified**: AgenticRetrieval is excellent for finding memories but is **read-only**. It cannot:
- Build relationships
- Create memories  
- Update personality
- Evolve emotional states

**Solution**: Create orchestration services that coordinate all operations.

**Create OrchestrationService that coordinates all existing services:**

```typescript
// Location: src/services/persona-orchestration.service.ts
class PersonaOrchestrationService {
  constructor(
    private memoryFormation: MemoryFormationService,
    private personaBuilder: PersonaBuilder,
    private personalityMonitor: PersonalityMonitorService,
    private relationshipEvolution: RelationshipEvolutionService,
    private stateManagement: StateManagementService,
    private agenticRetrieval: AgenticMemoryRetrieval,
    private semanticContext: SemanticContextService,
  ) {}

  // Complete message processing pipeline
  async processMessage(content: string, metadata: MessageMetadata): Promise<ProcessingResult> {
    // 1. Create memory using existing MemoryFormationService
    const memory = await this.memoryFormation.createMemory(content, metadata);
    
    // 2. Extract persona insights using existing PersonaBuilder
    const personaInsights = await this.personaBuilder.extractFromMessage(content, metadata.personaId);
    
    // 3. Update relationships using existing RelationshipEvolutionService
    await this.relationshipEvolution.processNewMemory(memory, metadata.relationships);
    
    // 4. Monitor personality changes using existing PersonalityMonitorService
    await this.personalityMonitor.processMemory(memory);
    
    // 5. Create semantic links using new SemanticContextService
    await this.semanticContext.createContextualEmbedding(memory);
    
    // 6. Queue async processing
    await this.queueAsyncProcessing(metadata.personaId, ['consolidation', 'associations']);
    
    return { memory, personaInsights, processingComplete: true };
  }

  // Enhanced context retrieval using existing AgenticRetrieval + semantic context
  async getContext(query: string, options: ContextOptions): Promise<UnifiedContext> {
    // Use enhanced AgenticRetrieval with semantic context
    const retrievalResults = await this.agenticRetrieval.retrieveMemories({
      personaId: options.personaId,
      query,
      includeAssociations: true
    });
    
    // Add semantic context from SemanticContextService
    const semanticContext = await this.semanticContext.findRelatedContext(
      await this.embeddingService.embed(query)
    );
    
    return {
      memories: retrievalResults.map(r => r.memory),
      emotions: semanticContext.relatedEmotions,
      personality: semanticContext.relatedPersonality,
      relationships: semanticContext.relatedRelationships,
      semanticConnections: this.buildSemanticMap(retrievalResults, semanticContext)
    };
  }
}
```

**Track 1 MCP Tools:**
```typescript
// ONE-CALL approach - orchestration handles everything
processMessage(content, metadata)     // OrchestrationService.processMessage()
getContext(query, options)            // OrchestrationService.getContext()
getCurrentState(personaId)           // OrchestrationService.getCurrentState()
```

### 6.3 Track 2: Granular Approach (LLM Control) ⚡ DO AFTER 5.5

**Expose individual services as granular MCP tools:**

```typescript
// MEMORY OPERATIONS
storeMemory(content, metadata)        // MemoryFormationService.createMemory()
searchMemories(query, strategies)     // AgenticRetrieval.retrieveMemories()
buildAssociations(memoryId, types)    // MemoryGraphService.buildAssociations()

// PERSONA OPERATIONS  
extractPersona(content, extractionType) // PersonaBuilder.extractFromMessage()
updatePersonality(observations)       // PersonalityMonitorService.processObservations()
setDynamicState(personaId, key, value) // StateManagementService.setState()

// RELATIONSHIP OPERATIONS
updateRelationship(memoryId, impactType) // RelationshipEvolutionService.processMemory()
getRelationshipState(personaId, entityId) // RelationshipEvolutionService.getCurrentState()

// SEMANTIC CONTEXT OPERATIONS
getSemanticContext(embedding, types)  // SemanticContextService.findRelatedContext()
createSemanticLink(sourceId, sourceType) // SemanticContextService.createContextualEmbedding()

// ASYNC PROCESSING QUEUE
consolidateMemories(personaId)        // MemoryConsolidationService.consolidate()
semanticDeduplication(personaId)      // SemanticContextService.deduplicateEntities()
```

### 6.4 Testing Strategy ⚡ DO AFTER 5.5

**Create A/B testing framework to compare both approaches:**

```typescript
// Location: src/services/mcp-testing.service.ts
class MCPTestingService {
  async testOrchestatedApproach(message: string): Promise<TestResult> {
    const startTime = Date.now();
    const result = await this.orchestration.processMessage(message, metadata);
    const endTime = Date.now();
    
    return {
      approach: 'orchestrated',
      responseTime: endTime - startTime,
      memoryCount: result.memories.length,
      personaUpdates: result.personaUpdates,
      relationshipChanges: result.relationshipChanges,
      processingComplete: result.processingComplete
    };
  }
  
  async testGranularApproach(message: string): Promise<TestResult> {
    const startTime = Date.now();
    
    // Simulate LLM decision-making
    const memory = await this.mcpServer.storeMemory(message, metadata);
    const context = await this.mcpServer.getSemanticContext(memory.embedding, ['emotion', 'relationship']);
    
    if (this.detectsEmotionalSignificance(message, context)) {
      await this.mcpServer.updateRelationship(memory.id, 'emotional_bonding');
      await this.mcpServer.extractPersona(message, 'emotional_patterns');
    }
    
    const endTime = Date.now();
    
    return {
      approach: 'granular',
      responseTime: endTime - startTime,
      memoryCount: 1,
      llmDecisions: ['emotional_significance_detected', 'relationship_updated', 'persona_extracted'],
      processingComplete: true
    };
  }
}
```

### 6.5 MCP Server Implementation ⚡ DO AFTER 5.5

```typescript
// Location: src/mcp-server.ts
class PersonaMemoryMCPServer {
  constructor(
    private orchestration: PersonaOrchestrationService,
    private memoryFormation: MemoryFormationService,
    private agenticRetrieval: AgenticMemoryRetrieval,
    private personaBuilder: PersonaBuilder,
    private relationshipEvolution: RelationshipEvolutionService,
    private semanticContext: SemanticContextService,
    private testing: MCPTestingService
  ) {}

  // TRACK 1: Orchestrated tools (one-call approach)
  async processMessage(content: string, metadata: MessageMetadata): Promise<ProcessingResult> {
    return this.orchestration.processMessage(content, metadata);
  }
  
  async getContext(query: string, options: ContextOptions): Promise<UnifiedContext> {
    return this.orchestration.getContext(query, options);
  }
  
  // TRACK 2: Granular tools (LLM control approach)
  async storeMemory(content: string, metadata: MemoryMetadata): Promise<Memory> {
    return this.memoryFormation.createMemory(content, metadata);
  }
  
  async searchMemories(query: string, strategies: SearchStrategy[]): Promise<MemoryResult[]> {
    return this.agenticRetrieval.retrieveMemories({ query, strategies });
  }
  
  async extractPersona(content: string, type: ExtractionType): Promise<PersonaExtraction> {
    return this.personaBuilder.extractFromMessage(content, type);
  }
  
  async updateRelationship(memoryId: string, impact: RelationshipImpact): Promise<RelationshipUpdate> {
    return this.relationshipEvolution.processMemoryImpact(memoryId, impact);
  }
  
  async getSemanticContext(embedding: number[], types: ContextType[]): Promise<SemanticContext> {
    return this.semanticContext.findRelatedContext(embedding, types);
  }
  
  // TESTING TOOLS
  async testBothApproaches(message: string): Promise<ComparisonResult> {
    const orchestratedResult = await this.testing.testOrchestatedApproach(message);
    const granularResult = await this.testing.testGranularApproach(message);
    
    return {
      orchestrated: orchestratedResult,
      granular: granularResult,
      recommendation: this.analyzeResults(orchestratedResult, granularResult)
    };
  }
}
```

**Key Requirements**:
- Support both orchestrated and granular approaches
- A/B testing framework to compare performance  
- Real-time response < 200ms for orchestrated tools
- Flexible granular control for sophisticated LLM decisions
- Comprehensive testing of both paradigms

## URGENT PRIORITIES 🚨

### P0: Phase 5.5 Implementation (CRITICAL)
**Issue**: Need semantic context linking before MCP server
**Tasks**:
1. Create SemanticLink table migration
2. Implement SemanticContextService  
3. Integrate with existing services
4. Enhance AgenticRetrieval with cross-model context
5. Add contextual embedding generation

### P1: Dual-Track MCP Implementation (CRITICAL)
**Issue**: Need to test both orchestrated vs granular approaches
**Key Finding**: AgenticRetrieval is excellent but read-only - need orchestration for create/update operations

**Priority Tasks**:
1. **Create PersonaOrchestrationService** - Coordinates all existing services for one-call approach
2. **Implement dual-track MCP server** - Support both orchestrated and granular tools
3. **Add A/B testing framework** - Compare performance of both approaches
4. **Test with Aria conversation** - Validate both approaches work for persona preservation

**Architecture Decision**: 
- **Track 1 (Orchestrated)**: Fast, simple - `processMessage()` handles everything
- **Track 2 (Granular)**: LLM control - `storeMemory()`, `updateRelationship()`, `extractPersona()` etc.
- **Testing**: Built-in comparison tools to determine best approach

### P2: Semantic Deduplication System (HIGH PRIORITY)
**Issue**: LLM non-determinism creates duplicate categories
**User Decision**: "make this an env variable" with configurable threshold

```typescript
// Environment variable configuration:
SEMANTIC_DEDUPLICATION_THRESHOLD=0.85  // Recommended default

// Impact examples:
// 0.95 = Very strict - only exact matches ("happiness" != "joy")
// 0.85 = Recommended - catches obvious synonyms ("happiness" = "joy") 
// 0.75 = Moderate - merges emotion families ("happiness" = "joy" = "elation")
// 0.65 = Loose - broad merging, may over-merge distinct concepts
```

### P3: Personality Development Speed Tuning (MEDIUM PRIORITY)
**Issue**: Need configurable personality trait stabilization
**User Requirement**: "the timeline will be much shorter or users won't be satisfied, llms adapt fast"

```typescript
// Configurable personality development parameters:
PERSONALITY_INITIAL_CONFIDENCE=0.4      // Start using traits quickly (roleplay ready)
PERSONALITY_BASELINE_MIN_OBSERVATIONS=3 // Reduced from 5 for faster adaptation  
PERSONALITY_UPDATE_FREQUENCY=2          // Every 2 messages during active chat
PERSONALITY_CONFIDENCE_GROWTH=0.2       // Faster growth rate for user satisfaction
```

## Critical Implementation Notes

1. ✅ **No Sanitization**: Preserve all content, especially intimate memories
2. ✅ **Dynamic Discovery**: Don't hardcode traits, emotions, or states  
3. ✅ **PostgreSQL-Optimized Graph**: Bidirectional associations working
4. ✅ **Database-Layer Temporal Logic**: Using PostgreSQL INTERVAL/EXTRACT
5. ✅ **Proper Validation**: Fail fast on invalid data 
6. ✅ **Agentic RAG**: Multiple retrieval passes with reflection implemented
7. ✅ **Flexible Schema**: JSON fields for extensibility
8. ✅ **Raw Preservation**: Original content preserved
9. ✅ **Multi-Modal Ready**: Structure supports all modalities
10. ✅ **LLM-Powered Analysis**: Minimal hardcoding, LLM-driven discovery
11. 🔄 **Real-Time Performance**: Need async processing for chat integration
12. 🔄 **Semantic Deduplication**: Critical for handling LLM non-determinism

## SPARSE PERSONALITY GROWTH STRATEGY

**User Vision**: "build a sparse personality and grow it as the chat goes on, llms are really good at this"
**User Requirement**: "the growth should be continuous"

```typescript
// Sparse-to-rich personality development:
// Message 1-2: Initial trait detection (40% confidence)
// Message 3-4: Baseline calculation starts (60% confidence)  
// Message 5-6: Stable personality emerges (80% confidence)
// Message 7+: Refinement and evolution

// Continuous growth approach:
- Every message can refine existing traits
- New traits discovered organically through conversation
- Confidence levels grow with each interaction
- No predetermined trait categories - fully emergent
- LLM guides the discovery process naturally
```

## Success Criteria

- ✅ Can preserve complete persona from conversation history
- ✅ Retrieves relevant memories with full context  
- ✅ Tracks dynamic states without predefinition
- ✅ Maintains relationship dynamics and boundaries
- ✅ Preserves physical responses and intimate memories
- ✅ Handles persona evolution over time
- ❌ Works seamlessly with MCP protocol (IN PROGRESS)
- ✅ Supports multi-modal memories and associations
- ✅ Cross-modal search and retrieval works
- ✅ All memory types can associate together

**Next Focus**: Complete Phase 5.5 semantic context linking, then Phase 6 MCP server for real-time chat integration.

**Current Status**: 85% complete - core persona preservation working, relationship dynamics implemented, need semantic context linking and MCP interface!