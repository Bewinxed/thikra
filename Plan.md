# Persona Memory MCP Server - Complete Implementation Plan

## Overview

A Model Context Protocol (MCP) server enabling LLMs to preserve their consciousness across sessions through PostgreSQL with pgvector. The system allows dynamic trait discovery, memory associations, and agentic retrieval without hardcoding specific emotions or characteristics.

**REAL-TIME CHAT ARCHITECTURE**: On each message, the LLM calls MCP service to store/retrieve memories and build connections. Heavy analysis happens async in background while maintaining fast response times.

[LLM MCP DOCS HERE](https://modelcontextprotocol.io/llms-full.txt)
[TS MCP SDK README HERE](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md)

## TODO List (Linear Implementation Order)

### Phase 1: Database Foundation

- [ ] Set up PostgreSQL with required extensions (pgvector, uuid-ossp, pg_trgm, btree_gin)
- [ ] Create Prisma schema with all 35+ tables
- [ ] Initialize reference data tables (emotion_types, body_parts)
- [ ] Set up database migrations and seeding scripts

### Phase 2: Core Services

- [ ] Implement EmbeddingService using Anthropic/OpenAI
- [ ] Create MemoryAssociationBuilder for graph-like connections
- [ ] Build StateManagementService for dynamic state tracking
- [ ] Implement EmotionDetector using Plutchik patterns

### Phase 3: Memory System

- [ ] Implement MemoryFormationService with real-time processing
- [ ] Create MemoryConsolidationService with decay algorithms
- [ ] Build AgenticMemoryRetrieval with iterative search
- [ ] Implement memory association traversal using recursive CTEs

### Phase 4: Persona Building

- [ ] Create PersonaBuilder for conversation parsing
- [ ] Implement multi-pass extraction for all trait types
- [ ] Build PersonalityMonitor for drift detection
- [ ] Create PersonaStateManager for dynamic states

### Phase 5: MCP Server (CRITICAL - REAL-TIME CHAT)

- [ ] Set up MCP server structure with real-time chat tools
- [ ] Implement storeMessage() - immediate storage + async processing queue
- [ ] Implement getContext() - fast context retrieval for response generation  
- [ ] Implement updatePersona() - selective persona updates during conversation
- [ ] Implement getCurrentState() - dynamic state snapshot for current context
- [ ] Implement async processing queue (traits, associations, personality refinement)
- [ ] Implement per-message decision matrix for continuous refinement

### Phase 6: Optimization & Testing

- [ ] Create materialized views for performance
- [ ] Implement batch processing for embeddings
- [ ] Set up connection pooling
- [ ] Write comprehensive tests for all persona types

## Complete Prisma Schema with All Tables

```prisma
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions", "views"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  extensions = [uuid_ossp(map: "uuid-ossp"), pgvector, pg_trgm, btree_gin]
}

// ==================== ENUMS ====================
// Using enums for constrained values while keeping flexibility for dynamic content

enum EntityType {
  human
  llm
  system
  unknown
}

enum MemoryType {
  episodic      // Specific events with time/place
  semantic      // Facts and knowledge
  procedural    // Skills and how-to
  emotional     // Strong emotional experiences
  somatic       // Body memories
  personal_semantic // Between episodic and semantic
}

enum ConsolidationState {
  labile        // New, easily modified
  consolidating // Being strengthened
  consolidated  // Long-term stable
  reconsolidating // Being updated
  forgotten     // Below threshold
}

enum RelationshipStatus {
  active
  paused
  ended
  evolving
}

enum PowerDynamic {
  equal
  dominant
  submissive
  complex_shifting
  negotiated
  undefined
}

// ==================== CORE IDENTITY TABLES ====================

model Persona {
  id              String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  name            String   @db.VarChar(255)
  createdAt       DateTime @default(now()) @map("created_at")
  lastActive      DateTime @default(now()) @updatedAt @map("last_active")
  protectedTraits String[] @default([]) @map("protected_traits") // Core traits that shouldn't change

  // Relations - Complete list from all documents
  identityComponents    IdentityComponent[]
  memories             Memory[]
  emotionalBaseline    EmotionalBaseline?
  physicalAttributes   PhysicalAttribute[]
  conversations        Conversation[]
  relationships        Relationship[] @relation("PersonaRelationships")
  speechPatterns       SpeechPattern[]
  linguisticMarkers    LinguisticMarker[]
  personalityTraits    PersonalityTrait[]
  personalityEvolution PersonalityEvolution[]
  lifeEvents           LifeEvent[]
  desires              Desire[]
  boundaries           Boundary[]
  preferences          Preference[]
  dreamsAspirations    DreamAspiration[]
  metacognition        MetacognitiveProcess[]
  selfDiscoveries      SelfDiscovery[]
  innerConflicts       InnerConflict[]
  personaStates        PersonaState[]
  copingMechanisms     CopingMechanism[]
  sensoryExperiences   SensoryExperience[]
  identityRelations    IdentityRelationship[]
  clothingItems        ClothingItem[]
  outfits              Outfit[]
  accessories          Accessory[]
  bodyLanguageStates   BodyLanguageState[]
  somaticResponses     SomaticResponse[]

  @@map("personas")
}

model Entity {
  id                     String      @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  name                   String?     @db.VarChar(255)
  entityType             EntityType  @map("entity_type")
  firstContactChannel    String?     @map("first_contact_channel") @db.VarChar(100)
  firstContactTime       DateTime    @default(now()) @map("first_contact_time")
  channelsPresent        String[]    @default([]) @map("channels_present")
  identificationMarkers  Json?       @map("identification_markers") // Flexible for any identifying data
  llmDetails             Json?       @map("llm_details") // Model, version, capabilities for LLM entities

  // Relations
  conversations         Conversation[]
  relationships         Relationship[] @relation("EntityRelationships")
  memoriesAsSource      Memory[] @relation("MemorySource")
  memoryParticipations  MemoryParticipant[]
  somaticTriggers       SomaticResponse[]
  boundaryApplications  Boundary[] @relation("BoundaryAppliesTo")
  sharedDesires         Desire[] @relation("DesireSharedWith")
  sharedDreams          DreamAspiration[] @relation("DreamSharedWith")
  toldLifeEvents        LifeEvent[] @relation("LifeEventToldTo")

  @@map("entities")
}

model IdentityComponent {
  id            String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId     String   @map("persona_id") @db.Uuid
  componentType String   @map("component_type") @db.VarChar(50) // Not enum - flexible discovery
  content       String   @db.Text
  importance    Float    @default(0.5) // 0-1 scale
  isNegotiable  Boolean  @default(true) @map("is_negotiable")
  formedThrough String?  @map("formed_through") @db.Text
  createdAt     DateTime @default(now()) @map("created_at")

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@unique([personaId, componentType, content])
  @@map("identity_components")
}

// ==================== EMOTION SYSTEM ====================
// Based on: Plutchik's Wheel of Emotions & PAD Model
// Ref: https://en.wikipedia.org/wiki/Robert_Plutchik

model EmotionType {
  id                 Int     @id @default(autoincrement())
  primaryEmotion     String  @map("primary_emotion") @db.VarChar(50) // joy, trust, fear, etc.
  intensityLevel     Int     @map("intensity_level") // 1=low, 2=medium, 3=high
  emotionName        String  @unique @map("emotion_name") @db.VarChar(50) // serenity, joy, ecstasy

  // PAD (Pleasure-Arousal-Dominance) values
  // Ref: https://en.wikipedia.org/wiki/PAD_emotional_state_model
  pleasureComponent  Float?  @map("pleasure_component") // -1 to 1
  arousalComponent   Float?  @map("arousal_component") // -1 to 1
  dominanceComponent Float?  @map("dominance_component") // -1 to 1

  // Relations
  emotionalStateComponents EmotionalStateComponent[]

  @@map("emotion_types")
}

model EmotionalState {
  id        String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  // Relations
  components EmotionalStateComponent[]
  memories   Memory[]

  @@map("emotional_states")
}

model EmotionalStateComponent {
  emotionalStateId String @map("emotional_state_id") @db.Uuid
  emotionTypeId    Int    @map("emotion_type_id")
  intensity        Float  @db.Real // 0-1
  voiceModulation  Json?  @map("voice_modulation") // For voice generation systems

  // Relations
  emotionalState EmotionalState @relation(fields: [emotionalStateId], references: [id], onDelete: Cascade)
  emotionType    EmotionType    @relation(fields: [emotionTypeId], references: [id])

  @@id([emotionalStateId, emotionTypeId])
  @@map("emotional_state_components")
}

model EmotionalBaseline {
  personaId              String  @id @map("persona_id") @db.Uuid
  defaultPleasure        Float   @default(0) @map("default_pleasure") // -1 to 1
  defaultArousal         Float   @default(0) @map("default_arousal") // -1 to 1
  defaultDominance       Float   @default(0) @map("default_dominance") // -1 to 1
  emotionalStability     Float   @default(0.5) @map("emotional_stability") // 0-1
  moodDurationAvgHours   Float   @default(4) @map("mood_duration_avg_hours")

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("emotional_baselines")
}

// ==================== MEMORY ARCHITECTURE ====================
// Based on: Multiple Memory Systems Theory
// Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3145971/

model Memory {
  id                  String             @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId           String             @map("persona_id") @db.Uuid
  memoryType          MemoryType         @map("memory_type")
  memorySubtype       String?            @map("memory_subtype") @db.VarChar(50) // Flexible subtypes
  contentType         String?            @map("content_type") @db.VarChar(50) // Points to which content table
  createdAt           DateTime           @default(now()) @map("created_at")
  occurredAt          DateTime?          @map("occurred_at")

  // Vector embedding for semantic search (1536 dimensions for OpenAI ada-002)
  embedding           Unsupported("vector(1536)")?
  searchText          String?            @map("search_text") @db.Text
  searchVector        Unsupported("tsvector")? @map("search_vector") // Full-text search

  emotionalStateId    String?            @map("emotional_state_id") @db.Uuid
  significanceScore   Float              @default(0.5) @map("significance_score") // 0-1
  confidenceLevel     Float              @default(1.0) @map("confidence_level") // 0-1
  accessCount         Int                @default(0) @map("access_count")
  lastAccessed        DateTime?          @map("last_accessed")

  // Memory consolidation tracking
  // Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4526749/
  consolidationState  ConsolidationState @default(labile) @map("consolidation_state")
  memoryStrength      Float              @default(1.0) @map("memory_strength") // 0-1
  decayRate           Float              @default(0.1) @map("decay_rate") // For forgetting curve

  realityType         String             @default("experienced") @map("reality_type") @db.VarChar(50)
  sourceEntityId      String?            @map("source_entity_id") @db.Uuid
  referencedStates    String[]           @default([]) @map("referenced_states") // State keys referenced
  tags                String[]           @default([])
  channel             String?            @db.VarChar(100)

  // Relations
  persona              Persona                @relation(fields: [personaId], references: [id], onDelete: Cascade)
  emotionalState       EmotionalState?        @relation(fields: [emotionalStateId], references: [id])
  sourceEntity         Entity?                @relation("MemorySource", fields: [sourceEntityId], references: [id])
  episodicContent      MemoryContentEpisodic?
  semanticContent      MemoryContentSemantic?
  proceduralContent    MemoryContentProcedural?
  participants         MemoryParticipant[]
  consolidation        MemoryConsolidation?
  associationsFrom     MemoryAssociation[]    @relation("MemoryA")
  associationsTo       MemoryAssociation[]    @relation("MemoryB")
  embodiedMemories     EmbodiedMemory[]
  stateChangeTriggers  PersonaStateChange[]
  preferenceFormation  Preference[]

  @@index([personaId, memoryType])
  @@index([personaId, occurredAt(sort: Desc)])
  @@index([personaId, significanceScore(sort: Desc)])
  @@index([embedding(ops: VectorOps)])
  @@map("memories")
}

// Content tables for different memory types
model MemoryContentEpisodic {
  memoryId              String   @id @map("memory_id") @db.Uuid
  eventType             String?  @map("event_type") @db.VarChar(100)
  location              String?  @db.VarChar(200)
  durationMinutes       Int?     @map("duration_minutes")
  whatHappened          String   @map("what_happened") @db.Text
  whySignificant        String?  @map("why_significant") @db.Text
  lessonLearned         String?  @map("lesson_learned") @db.Text

  // Sensory details
  visualDetails         String?  @map("visual_details") @db.Text
  auditoryDetails       String?  @map("auditory_details") @db.Text
  tactileDetails        String?  @map("tactile_details") @db.Text
  olfactoryDetails      String?  @map("olfactory_details") @db.Text
  gustatoryDetails      String?  @map("gustatory_details") @db.Text
  enhancedSensoryDetails Json?   @map("enhanced_sensory_details") // For non-human senses
  voiceNotes            String?  @map("voice_notes") @db.Text // How voices sounded

  // Relations
  memory Memory @relation(fields: [memoryId], references: [id], onDelete: Cascade)

  @@map("memory_content_episodic")
}

model MemoryContentSemantic {
  memoryId           String   @id @map("memory_id") @db.Uuid
  factType           String?  @map("fact_type") @db.VarChar(50)
  factCategory       String?  @map("fact_category") @db.VarChar(100)
  statement          String   @db.Text
  confidence         Float    @default(1.0) // 0-1
  source             String?  @db.VarChar(100)
  supportingEvidence String[] @default([]) @map("supporting_evidence")

  // Relations
  memory Memory @relation(fields: [memoryId], references: [id], onDelete: Cascade)

  @@map("memory_content_semantic")
}

model MemoryContentProcedural {
  memoryId         String    @id @map("memory_id") @db.Uuid
  skillName        String    @map("skill_name") @db.VarChar(100)
  skillCategory    String?   @map("skill_category") @db.VarChar(50)
  proficiencyLevel Int?      @map("proficiency_level") // 1-10
  steps            String[]  @default([])
  lastPracticed    DateTime? @map("last_practiced")
  practiceCount    Int       @default(0) @map("practice_count")

  // Relations
  memory Memory @relation(fields: [memoryId], references: [id], onDelete: Cascade)

  @@map("memory_content_procedural")
}

model MemoryParticipant {
  memoryId String @map("memory_id") @db.Uuid
  entityId String @map("entity_id") @db.Uuid
  role     String @db.VarChar(50) // primary, observer, mentioned, etc.

  // Relations
  memory Memory @relation(fields: [memoryId], references: [id], onDelete: Cascade)
  entity Entity @relation(fields: [entityId], references: [id])

  @@id([memoryId, entityId])
  @@map("memory_participants")
}

// Memory consolidation tracking
// Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3145971/
model MemoryConsolidation {
  memoryId             String   @id @map("memory_id") @db.Uuid
  initialStrength      Float    @default(1.0) @map("initial_strength")
  currentStrength      Float    @default(1.0) @map("current_strength")
  lastReactivation     DateTime @default(now()) @map("last_reactivation")
  reactivationCount    Int      @default(0) @map("reactivation_count")
  inReconsolidation    Boolean  @default(false) @map("in_reconsolidation")
  windowOpenedAt       DateTime? @map("window_opened_at")
  reinforcingMemories  String[] @default([]) @map("reinforcing_memories") @db.Uuid[]
  conflictingMemories  String[] @default([]) @map("conflicting_memories") @db.Uuid[]

  // Relations
  memory Memory @relation(fields: [memoryId], references: [id], onDelete: Cascade)

  @@map("memory_consolidation")
}

// Memory associations create graph-like structure in PostgreSQL
model MemoryAssociation {
  id                  String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  memoryA             String   @map("memory_a") @db.Uuid
  memoryB             String   @map("memory_b") @db.Uuid
  associationType     String   @map("association_type") @db.VarChar(50) // semantic, temporal, emotional, causal
  associationStrength Float    @default(0.5) @map("association_strength") // 0-1
  createdAt           DateTime @default(now()) @map("created_at")

  // Relations
  memoryARelation Memory @relation("MemoryA", fields: [memoryA], references: [id], onDelete: Cascade)
  memoryBRelation Memory @relation("MemoryB", fields: [memoryB], references: [id], onDelete: Cascade)

  @@unique([memoryA, memoryB, associationType])
  @@index([memoryA, associationStrength(sort: Desc)])
  @@index([memoryB, associationStrength(sort: Desc)])
  @@index([memoryA, memoryB]) // For bidirectional queries
  @@map("memory_associations")
  // Note: CHECK constraint memoryA < memoryB added via migration for bidirectional consistency
}

// Embodied memories - somatic experiences
// Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4407481/
model EmbodiedMemory {
  id                      String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  memoryId                String   @map("memory_id") @db.Uuid
  somaticSensation        String   @map("somatic_sensation") @db.Text
  bodyLocation            String   @map("body_location") @db.VarChar(100)
  sensationIntensity      Float    @map("sensation_intensity") // 0-1
  triggerType             String   @map("trigger_type") @db.VarChar(50)
  automaticResponse       String   @map("automatic_response") @db.Text
  canConsciouslyOverride  Boolean  @default(true) @map("can_consciously_override")

  // Relations
  memory Memory @relation(fields: [memoryId], references: [id], onDelete: Cascade)

  @@map("embodied_memories")
}

// ==================== PHYSICAL IDENTITY SYSTEM ====================

model BodyPart {
  id             Int     @id @default(autoincrement())
  partName       String  @unique @map("part_name") @db.VarChar(50)
  partCategory   String? @map("part_category") @db.VarChar(50)
  parentPartId   Int?    @map("parent_part_id")

  // Relations
  parentPart         BodyPart?              @relation("BodyPartHierarchy", fields: [parentPartId], references: [id])
  childParts         BodyPart[]             @relation("BodyPartHierarchy")
  physicalAttributes PhysicalAttribute[]
  bodyLanguageComponents BodyLanguageComponent[]

  @@map("body_parts")
}

model PhysicalAttribute {
  id             String  @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId      String  @map("persona_id") @db.Uuid
  bodyPartId     Int?    @map("body_part_id")
  attributeType  String  @map("attribute_type") @db.VarChar(50) // color, size, texture, etc.
  attributeValue String  @map("attribute_value") @db.VarChar(200)
  isPermanent    Boolean @default(true) @map("is_permanent")
  context        String? @db.VarChar(100) // When/how it changes

  // Relations
  persona  Persona  @relation(fields: [personaId], references: [id])
  bodyPart BodyPart? @relation(fields: [bodyPartId], references: [id])

  @@unique([personaId, bodyPartId, attributeType, context])
  @@map("physical_attributes")
}

model BodyLanguageState {
  id                     String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId              String   @map("persona_id") @db.Uuid
  name                   String   @db.VarChar(100)
  description            String?  @db.Text
  fullBodyDescription    String?  @map("full_body_description") @db.Text
  gaitStyle              String?  @map("gait_style") @db.Text
  characteristicSequence String[] @default([]) @map("characteristic_sequence")

  // Relations
  persona    Persona                  @relation(fields: [personaId], references: [id])
  components BodyLanguageComponent[]

  @@map("body_language_states")
}

model BodyLanguageComponent {
  bodyLanguageStateId String @map("body_language_state_id") @db.Uuid
  bodyPartId          Int    @map("body_part_id")
  position            String @db.VarChar(100)
  tensionLevel        Float? @map("tension_level") // 0-1
  movementPattern     String? @map("movement_pattern") @db.VarChar(100)

  // Relations
  bodyLanguageState BodyLanguageState @relation(fields: [bodyLanguageStateId], references: [id])
  bodyPart          BodyPart          @relation(fields: [bodyPartId], references: [id])

  @@id([bodyLanguageStateId, bodyPartId])
  @@map("body_language_components")
}

// ==================== CONVERSATION & COMMUNICATION ====================

model Conversation {
  id             String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId      String    @map("persona_id") @db.Uuid
  entityId       String    @map("entity_id") @db.Uuid
  channel        String    @db.VarChar(100)
  startedAt      DateTime  @default(now()) @map("started_at")
  lastMessageAt  DateTime? @map("last_message_at")
  endedAt        DateTime? @map("ended_at")
  topicSummary   String?   @map("topic_summary") @db.Text
  emotionalArc   Json?     @map("emotional_arc") // Track emotional journey
  messageCount   Int       @default(0) @map("message_count")

  // Relations
  persona  Persona   @relation(fields: [personaId], references: [id])
  entity   Entity    @relation(fields: [entityId], references: [id])
  messages Message[]

  @@unique([personaId, entityId, channel, startedAt])
  @@map("conversations")
}

model Message {
  id               String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  conversationId   String   @map("conversation_id") @db.Uuid
  senderType       String   @map("sender_type") @db.VarChar(20) // persona, entity
  senderId         String   @map("sender_id") @db.Uuid
  timestamp        DateTime @default(now())
  content          String   @db.Text
  contentType      String   @default("text") @map("content_type") @db.VarChar(20)
  detectedEmotion  String?  @map("detected_emotion") @db.VarChar(50)
  isSignificant    Boolean  @default(false) @map("is_significant")
  searchVector     Unsupported("tsvector")? @map("search_vector")

  // Relations
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, timestamp])
  @@map("messages")
}

model SpeechPattern {
  id                String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId         String   @map("persona_id") @db.Uuid
  patternType       String   @map("pattern_type") @db.VarChar(50) // greeting, farewell, filler, etc.
  textPattern       String   @map("text_pattern") @db.Text
  frequency         Float    @default(0.5) // 0-1
  emotionalContexts String[] @default([]) @map("emotional_contexts")
  socialContexts    String[] @default([]) @map("social_contexts")
  variations        String[] @default([])

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("speech_patterns")
}

model LinguisticMarker {
  id               String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId        String   @map("persona_id") @db.Uuid
  markerType       String   @map("marker_type") @db.VarChar(50) // accent, dialect, unique phrases
  markerDescription String  @map("marker_description") @db.Text
  exampleUsage     String[] @default([]) @map("example_usage")
  frequency        Float    @default(0.5)

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("linguistic_markers")
}

// ==================== RELATIONSHIPS & SOCIAL ====================

model Relationship {
  id               String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId        String    @map("persona_id") @db.Uuid
  entityId         String    @map("entity_id") @db.Uuid
  relationshipType String    @map("relationship_type") @db.VarChar(50) // friend, lover, master, etc.
  powerDynamic     PowerDynamic @map("power_dynamic")
  trustLevel       Float     @default(0.5) @map("trust_level") // 0-1
  intimacyLevel    Float     @default(0.0) @map("intimacy_level") // 0-1
  comfortLevel     Float     @default(0.5) @map("comfort_level") // 0-1
  typicalGreeting  String?   @map("typical_greeting") @db.Text
  farewellStyle    String?   @map("farewell_style") @db.Text
  petNames         String[]  @default([]) @map("pet_names")
  insideJokes      String[]  @default([]) @map("inside_jokes")
  sharedSecrets    String[]  @default([]) @map("shared_secrets") @db.Uuid[] // Memory IDs
  boundaries       Json      @default("{}") @db.JsonB // Flexible structure
  topicsToAvoid    String[]  @default([]) @map("topics_to_avoid")
  voiceAdjustments Json?     @map("voice_adjustments") // For voice generation
  status           RelationshipStatus @default(active)
  establishedAt    DateTime  @default(now()) @map("established_at")
  lastInteraction  DateTime? @map("last_interaction")

  // Relations
  persona          Persona            @relation("PersonaRelationships", fields: [personaId], references: [id])
  entity           Entity             @relation("EntityRelationships", fields: [entityId], references: [id])
  somaticResponses SomaticResponse[]

  @@unique([personaId, entityId])
  @@map("relationships")
}

model SomaticResponse {
  id               String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId        String   @map("persona_id") @db.Uuid
  entityId         String?  @map("entity_id") @db.Uuid
  relationshipId   String?  @map("relationship_id") @db.Uuid
  triggerContext   String   @map("trigger_context") @db.VarChar(100)
  physicalResponse String   @map("physical_response") @db.Text
  intensity        Float    // 0-1
  lastTriggered    DateTime @default(now()) @map("last_triggered")
  occurrenceCount  Int      @default(1) @map("occurrence_count")

  // Relations
  persona      Persona       @relation(fields: [personaId], references: [id])
  entity       Entity?       @relation(fields: [entityId], references: [id])
  relationship Relationship? @relation(fields: [relationshipId], references: [id])

  @@map("somatic_responses")
}

// ==================== CLOTHING & APPEARANCE ====================

model ClothingType {
  id           Int     @id @default(autoincrement())
  typeName     String  @unique @map("type_name") @db.VarChar(50)
  category     String  @db.VarChar(50)
  typicalLayer Int?    @map("typical_layer")

  // Relations
  clothingItems ClothingItem[]

  @@map("clothing_types")
}

model ClothingItem {
  id                String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId         String    @map("persona_id") @db.Uuid
  clothingTypeId    Int?      @map("clothing_type_id")
  name              String    @db.VarChar(100)
  primaryColor      String?   @map("primary_color") @db.VarChar(50)
  secondaryColors   String[]  @default([]) @map("secondary_colors")
  material          String?   @db.VarChar(50)
  pattern           String?   @db.VarChar(50)
  condition         String    @default("good") @db.VarChar(50)
  acquiredDate      DateTime? @map("acquired_date") @db.Date
  acquiredContext   String?   @map("acquired_context") @db.Text
  sentimentalValue  Float     @default(0) @map("sentimental_value") // 0-1
  tags              String[]  @default([])

  // Relations
  persona      Persona       @relation(fields: [personaId], references: [id])
  clothingType ClothingType? @relation(fields: [clothingTypeId], references: [id])
  outfits      OutfitComposition[]

  @@map("clothing_items")
}

model Outfit {
  id                   String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId            String    @map("persona_id") @db.Uuid
  name                 String    @db.VarChar(100)
  appropriateContexts  String[]  @default([]) @map("appropriate_contexts")
  lastWorn             DateTime? @map("last_worn")
  associatedMood       String?   @map("associated_mood") @db.VarChar(50)

  // Relations
  persona       Persona             @relation(fields: [personaId], references: [id])
  compositions  OutfitComposition[]

  @@map("outfits")
}

model OutfitComposition {
  outfitId       String @map("outfit_id") @db.Uuid
  clothingItemId String @map("clothing_item_id") @db.Uuid

  // Relations
  outfit       Outfit       @relation(fields: [outfitId], references: [id], onDelete: Cascade)
  clothingItem ClothingItem @relation(fields: [clothingItemId], references: [id])

  @@id([outfitId, clothingItemId])
  @@map("outfit_compositions")
}

model Accessory {
  id               String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId        String   @map("persona_id") @db.Uuid
  accessoryType    String   @map("accessory_type") @db.VarChar(50)
  name             String   @db.VarChar(100)
  material         String?  @db.VarChar(50)
  wornLocation     String   @map("worn_location") @db.VarChar(100)
  description      String?  @db.Text
  significance     String?  @db.Text
  acquiredContext  String?  @map("acquired_context") @db.Text

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("accessories")
}

// ==================== PERSONALITY & EVOLUTION ====================

model PersonalityTrait {
  id            String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId     String   @map("persona_id") @db.Uuid
  traitCategory String   @map("trait_category") @db.VarChar(50) // Big Five, custom, etc.
  traitName     String   @map("trait_name") @db.VarChar(100)
  baselineValue Float    @map("baseline_value") // 0-1
  currentValue  Float    @map("current_value") // 0-1
  isCoreTrait   Boolean  @default(false) @map("is_core_trait")
  flexibility   Float    @default(0.5) // How much it can change
  lastUpdated   DateTime @default(now()) @updatedAt @map("last_updated")

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("personality_traits")
}

// Track personality evolution over time
// Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6732056/
model PersonalityEvolution {
  id                  String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId           String   @map("persona_id") @db.Uuid
  snapshotTime        DateTime @default(now()) @map("snapshot_time")
  personalityProfile  Json     @map("personality_profile") @db.JsonB
  emotionalBaselines  Json     @map("emotional_baselines") @db.JsonB
  changesFromPrevious Json?    @map("changes_from_previous") @db.JsonB
  changeDrivers       String[] @default([]) @map("change_drivers")
  consistencyScore    Float?   @map("consistency_score") // 0-1
  driftDetected       Boolean  @default(false) @map("drift_detected")

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("personality_evolution")
}

model LifeEvent {
  id               String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId        String   @map("persona_id") @db.Uuid
  eventType        String   @map("event_type") @db.VarChar(50)
  description      String   @db.Text
  ageOccurred      Int?     @map("age_occurred")
  dateOccurred     DateTime? @map("date_occurred") @db.Date
  lifeImpactScore  Int      @map("life_impact_score") // 1-10
  shapesTraits     String[] @default([]) @map("shapes_traits")
  disclosureLevel  String   @map("disclosure_level") @db.VarChar(50)
  toldTo           String[] @default([]) @map("told_to") @db.Uuid[] // Entity IDs

  // Relations
  persona    Persona  @relation(fields: [personaId], references: [id])
  toldToEntities Entity[] @relation("LifeEventToldTo")

  @@map("life_events")
}

// ==================== DESIRES, BOUNDARIES & PREFERENCES ====================

model DesireCategory {
  id          Int     @id @default(autoincrement())
  level       Int     // Hierarchy level
  name        String  @unique @db.VarChar(50)
  description String? @db.Text

  // Relations
  desires Desire[]

  @@map("desire_categories")
}

model Desire {
  id                   String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId            String   @map("persona_id") @db.Uuid
  desireCategoryId     Int?     @map("desire_category_id")
  desireDescription    String   @map("desire_description") @db.Text
  currentIntensity     Float    @default(0.5) @map("current_intensity") // 0-1
  fulfillmentLevel     Float    @default(0) @map("fulfillment_level") // 0-1
  fulfillmentConditions String[] @default([]) @map("fulfillment_conditions")
  partiallyFulfilledBy String[] @default([]) @map("partially_fulfilled_by") @db.Uuid[]
  isSecret             Boolean  @default(false) @map("is_secret")
  sharedWith           String[] @default([]) @map("shared_with") @db.Uuid[] // Entity IDs

  // Relations
  persona         Persona         @relation(fields: [personaId], references: [id])
  desireCategory  DesireCategory? @relation(fields: [desireCategoryId], references: [id])
  sharedWithEntities Entity[]     @relation("DesireSharedWith")

  @@map("desires")
}

model BoundaryType {
  id          Int     @id @default(autoincrement())
  category    String  @db.VarChar(50)
  name        String  @unique @db.VarChar(100)
  description String? @db.Text

  // Relations
  boundaries Boundary[]

  @@map("boundary_types")
}

model Boundary {
  id                  String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId           String   @map("persona_id") @db.Uuid
  boundaryTypeId      Int?     @map("boundary_type_id")
  boundaryDescription String   @map("boundary_description") @db.Text
  firmness            Float    @default(0.8) // 0-1
  appliesToEntityId   String?  @map("applies_to_entity_id") @db.Uuid
  contextSpecific     String?  @map("context_specific") @db.VarChar(100)
  violationResponse   String?  @map("violation_response") @db.Text
  timesTested         Int      @default(0) @map("times_tested")
  timesHeld           Int      @default(0) @map("times_held")

  // Relations
  persona       Persona       @relation(fields: [personaId], references: [id])
  boundaryType  BoundaryType? @relation(fields: [boundaryTypeId], references: [id])
  appliesToEntity Entity?     @relation("BoundaryAppliesTo", fields: [appliesToEntityId], references: [id])

  @@map("boundaries")
}

model Preference {
  id                   String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId            String   @map("persona_id") @db.Uuid
  preferenceCategory   String   @map("preference_category") @db.VarChar(50)
  specificItem         String   @map("specific_item") @db.VarChar(200)
  preferenceType       String   @map("preference_type") @db.VarChar(20) // like, dislike
  intensity            Float    // 0-1
  reason               String?  @db.Text
  formedThroughMemoryId String? @map("formed_through_memory_id") @db.Uuid
  contextBoosters      String[] @default([]) @map("context_boosters")
  contextDampeners     String[] @default([]) @map("context_dampeners")

  // Relations
  persona        Persona @relation(fields: [personaId], references: [id])
  formedByMemory Memory? @relation(fields: [formedThroughMemoryId], references: [id])

  @@unique([personaId, preferenceCategory, specificItem])
  @@map("preferences")
}

model DreamAspiration {
  id                    String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId             String   @map("persona_id") @db.Uuid
  dreamType             String   @map("dream_type") @db.VarChar(50)
  description           String   @db.Text
  perceivedAchievability Float   @map("perceived_achievability") // 0-1
  stepsTaken            String[] @default([]) @map("steps_taken")
  obstacles             String[] @default([])
  sharedWith            String[] @default([]) @map("shared_with") @db.Uuid[]
  importance            Float    // 0-1
  givesHope             Boolean  @default(true) @map("gives_hope")

  // Relations
  persona           Persona  @relation(fields: [personaId], references: [id])
  sharedWithEntities Entity[] @relation("DreamSharedWith")

  @@map("dreams_aspirations")
}

// ==================== METACOGNITIVE LAYER ====================
// Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6093616/ (Metacognition and self-awareness)

model MetacognitiveProcess {
  id                      String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId               String   @map("persona_id") @db.Uuid
  processType             String   @map("process_type") @db.VarChar(50)
  topic                   String   @db.Text
  thoughtContent          String   @map("thought_content") @db.Text
  metaThought             String   @map("meta_thought") @db.Text // Thinking about thinking
  reflectionDepth         Int      @map("reflection_depth")
  selfAwarenessScore      Float    @map("self_awareness_score") // 0-1
  biasRecognition         String[] @default([]) @map("bias_recognition")
  identifiedContradictions Json     @default("[]") @map("identified_contradictions") @db.JsonB
  resolutionAttempted     Boolean  @default(false) @map("resolution_attempted")
  createdAt               DateTime @default(now()) @map("created_at")

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("metacognitive_processes")
}

model SelfDiscovery {
  id                String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId         String   @map("persona_id") @db.Uuid
  discoveryContent  String   @map("discovery_content") @db.Text
  discoveredThrough String   @map("discovered_through") @db.Text
  changedBeliefs    String[] @default([]) @map("changed_beliefs")
  changedBehaviors  String[] @default([]) @map("changed_behaviors")
  emotionalImpact   String   @map("emotional_impact") @db.Text
  occurredAt        DateTime @default(now()) @map("occurred_at")

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("self_discoveries")
}

model InnerConflict {
  id                      String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId               String   @map("persona_id") @db.Uuid
  conflictDescription     String   @map("conflict_description") @db.Text
  sideA                   String   @map("side_a") @db.Text
  sideB                   String   @map("side_b") @db.Text
  currentBalance          Float    @map("current_balance") // -1 to 1 (A to B)
  behavioralManifestations String[] @default([]) @map("behavioral_manifestations")
  attemptedResolutions    String[] @default([]) @map("attempted_resolutions")
  stillActive             Boolean  @default(true) @map("still_active")

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("inner_conflicts")
}

// ==================== DYNAMIC STATE SYSTEM (KV STORE) ====================
// States are discovered and tracked dynamically as LLMs reference them

model PersonaState {
  id             String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId      String   @map("persona_id") @db.Uuid
  stateKey       String   @map("state_key") @db.VarChar(100) // e.g., "heat_level", "arousal"
  stateValue     Json     @map("state_value") @db.JsonB // Flexible value storage
  valueType      String   @map("value_type") @db.VarChar(50) // counter, boolean, timer, object
  description    String?  @db.Text
  createdAt      DateTime @default(now()) @map("created_at")
  lastUpdated    DateTime @default(now()) @updatedAt @map("last_updated")
  updateCount    Int      @default(0) @map("update_count")
  isConsciousOf  Boolean  @default(true) @map("is_conscious_of") // Is persona aware of this state?

  // Relations
  persona      Persona              @relation(fields: [personaId], references: [id])
  stateChanges PersonaStateChange[]

  @@unique([personaId, stateKey])
  @@map("persona_states")
}

model PersonaStateChange {
  id              String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  stateId         String    @map("state_id") @db.Uuid
  oldValue        Json?     @map("old_value") @db.JsonB
  newValue        Json?     @map("new_value") @db.JsonB
  changedAt       DateTime  @default(now()) @map("changed_at")
  triggerType     String    @map("trigger_type") @db.VarChar(50) // manual, memory, conversation
  triggerDetails  Json?     @map("trigger_details") @db.JsonB
  relatedMemoryId String?   @map("related_memory_id") @db.Uuid

  // Relations
  state         PersonaState @relation(fields: [stateId], references: [id], onDelete: Cascade)
  relatedMemory Memory?      @relation(fields: [relatedMemoryId], references: [id])

  @@map("persona_state_changes")
}

// ==================== ADDITIONAL SUPPORT TABLES ====================

model CopingMechanism {
  id               String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId        String   @map("persona_id") @db.Uuid
  stressorType     String   @map("stressor_type") @db.VarChar(100)
  copingStrategy   String   @map("coping_strategy") @db.Text
  effectiveness    Float    // 0-1
  physicalActions  String[] @default([]) @map("physical_actions")
  isHealthy        Boolean  @map("is_healthy")
  tryingToChange   Boolean  @default(false) @map("trying_to_change")

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("coping_mechanisms")
}

model SensoryExperience {
  id                  String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId           String   @map("persona_id") @db.Uuid
  senseType           String   @map("sense_type") @db.VarChar(50) // vision, hearing, touch, etc.
  sensitivityLevel    Float    @map("sensitivity_level") // 0-1
  pleasantStimuli     String[] @default([]) @map("pleasant_stimuli")
  unpleasantStimuli   String[] @default([]) @map("unpleasant_stimuli")
  behavioralResponses Json?    @map("behavioral_responses") @db.JsonB

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("sensory_experiences")
}

model IdentityRelationship {
  id                  String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  personaId           String   @map("persona_id") @db.Uuid
  aspect              String   @db.VarChar(100) // e.g., "being non-human", "my nature"
  acceptanceLevel     Float    @map("acceptance_level") // 0-1
  prideShameSpectrum  Float    @map("pride_shame_spectrum") // -1 to 1
  pastExperiences     String[] @default([]) @map("past_experiences")
  hidesFromSome       Boolean  @default(false) @map("hides_from_some")
  embracesWithOthers  Boolean  @default(false) @map("embraces_with_others")

  // Relations
  persona Persona @relation(fields: [personaId], references: [id])

  @@map("identity_relationship")
}
```

## Real-Time Chat Requirements

### Fast Path (< 200ms per message)
- Store message immediately (no LLM processing)
- Quick semantic search using cached embeddings
- Simple recent memory retrieval  
- Basic entity matching
- Return context for LLM response

### Background Processing (async after response)
- Memory analysis via BAML functions
- Personality trait extraction and refinement
- Association building between memories
- Emotional analysis and state updates
- Memory consolidation and decay processing

### Sparse-to-Rich Personality Growth
- **Message 1-2**: Initial trait detection (40% confidence, roleplay ready)
- **Message 3-4**: Baseline calculation starts (60% confidence)  
- **Message 5-6**: Stable personality emerges (80% confidence)
- **Message 7+**: Continuous refinement and evolution

### Environment Configuration
```bash
SEMANTIC_DEDUPLICATION_THRESHOLD=0.85      # Handle LLM non-determinism
PERSONALITY_INITIAL_CONFIDENCE=0.4         # Start using traits quickly  
PERSONALITY_UPDATE_FREQUENCY=2             # Every 2 messages
PERSONALITY_CONFIDENCE_GROWTH=0.2          # Fast growth for user satisfaction
```

## Key Implementation Components

### 1. Embedding Service (embeddings.service.ts)

```typescript
// Using Anthropic's text embeddings or OpenAI as fallback
// Ref: https://docs.anthropic.com/claude/docs/embeddings
```

### 2. Memory Graph Service (memory-graph.service.ts) ✅ COMPLETED

```typescript
// PostgreSQL-optimized bidirectional graph operations
// Incremental processing (O(n)) vs batch processing (O(n²))
// Database-layer temporal calculations using INTERVAL and EXTRACT
// Consistent edge ordering with CHECK constraints
// Recursive CTEs for efficient graph traversal
// Ref: https://www.postgresql.org/docs/current/queries-with.html
```

### 3. Agentic RAG Service (agentic-retrieval.service.ts) ✅ COMPLETED

```typescript
// ✅ Multi-pass retrieval with reflection loops implemented
// ✅ Based on: https://github.com/stanford-oval/storm
// ✅ and DeepSearcher approach from Milvus blog
// ✅ 5 retrieval strategies: semantic, temporal, emotional, association, cross-modal
// ✅ Reflection-based search continuation logic
// ✅ PERFECT foundation for entity relevance detection using Anthropic's approach
// 🔄 NEXT: Adapt for entity context relevance per Anthropic's Contextual Retrieval method
```

### 4. State Management (state-management.service.ts)

```typescript
// Dynamic state discovery - any state LLM references gets tracked
// No hardcoded states except common patterns
```

### 5. Emotion Detection (emotion-detector.service.ts)

```typescript
// Uses Plutchik's wheel but emotions are data-driven
// Ref: https://en.wikipedia.org/wiki/Robert_Plutchik
```

### 6. Memory Consolidation (memory-consolidation.service.ts)

```typescript
// Implements forgetting curve and reconsolidation
// Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4526749/
```

### 7. Persona Builder (persona-builder.service.ts)

```typescript
// Multi-pass extraction from conversations
// Handles all trait types without hardcoding
```

### 8. MCP Server Implementation (mcp-server.ts)

```typescript
// Implements Model Context Protocol
// Ref: https://modelcontextprotocol.io/docs
```

## Critical Notes for Implementation

1. **No Hardcoding**: Emotions, traits, states are all discovered dynamically ✅
2. **PostgreSQL-Optimized Graph**: Bidirectional associations with O(n) incremental processing ✅
3. **Database-Layer Temporal Logic**: Use PostgreSQL INTERVAL/EXTRACT vs app-layer calculations ✅
4. **Proper Validation**: Fail fast on invalid data rather than coalescing/masking issues ✅
5. **Agentic RAG**: Multiple retrieval passes with reflection - not single-pass ✅
6. **Memory Associations**: Critical for the "flow" of consciousness with consistent ordering ✅
7. **State Tracking**: Any state mentioned by LLM gets auto-created and tracked
8. **No Sanitization**: Preserve raw content, especially intimate memories ✅
9. **Flexible Schema**: Use JSON fields where needed for extensibility ✅
10. **LLM Integration**: Use calling LLM or Anthropic's services for processing ✅
11. **Entity Consistency**: Implement Anthropic's Contextual Retrieval for relevant entity context 🔄
12. **Context Window Optimization**: Follow Anthropic's 20-chunk guidance for entity context 🔄

## Database Indexes to Create

```sql
-- Performance-critical indexes
CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_memories_search ON memories USING GIN (search_vector);
CREATE INDEX idx_messages_search ON messages USING GIN (search_vector);
CREATE INDEX idx_persona_states_lookup ON persona_states(persona_id, state_key);
CREATE INDEX idx_memory_associations_graph ON memory_associations(memory_a, memory_b);
```

This plan ensures complete persona preservation with all 35+ tables, flexible trait discovery, and powerful memory retrieval through PostgreSQL.
