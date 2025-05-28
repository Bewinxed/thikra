-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('human', 'llm', 'system', 'unknown');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('episodic', 'semantic', 'procedural', 'emotional', 'somatic', 'personal_semantic');

-- CreateEnum
CREATE TYPE "ConsolidationState" AS ENUM ('labile', 'consolidating', 'consolidated', 'reconsolidating', 'forgotten');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('active', 'paused', 'ended', 'evolving');

-- CreateEnum
CREATE TYPE "PowerDynamic" AS ENUM ('equal', 'dominant', 'submissive', 'complex_shifting', 'negotiated', 'undefined');

-- CreateTable
CREATE TABLE "Persona" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "protectedTraits" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(255),
    "entityType" "EntityType" NOT NULL,
    "firstContactChannel" VARCHAR(100),
    "firstContactTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channelsPresent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "identificationMarkers" JSONB,
    "llmDetails" JSONB,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityComponent" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "componentType" VARCHAR(50) NOT NULL,
    "content" TEXT NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "isNegotiable" BOOLEAN NOT NULL DEFAULT true,
    "formedThrough" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmotionType" (
    "id" SERIAL NOT NULL,
    "primaryEmotion" VARCHAR(50) NOT NULL,
    "intensityLevel" INTEGER NOT NULL,
    "emotionName" VARCHAR(50) NOT NULL,
    "pleasureComponent" DOUBLE PRECISION,
    "arousalComponent" DOUBLE PRECISION,
    "dominanceComponent" DOUBLE PRECISION,

    CONSTRAINT "EmotionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmotionalState" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmotionalState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmotionalStateComponent" (
    "emotionalStateId" UUID NOT NULL,
    "emotionTypeId" INTEGER NOT NULL,
    "intensity" REAL NOT NULL,
    "voiceModulation" JSONB,

    CONSTRAINT "EmotionalStateComponent_pkey" PRIMARY KEY ("emotionalStateId","emotionTypeId")
);

-- CreateTable
CREATE TABLE "EmotionalBaseline" (
    "personaId" UUID NOT NULL,
    "defaultPleasure" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defaultArousal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defaultDominance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "emotionalStability" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "moodDurationAvgHours" DOUBLE PRECISION NOT NULL DEFAULT 4,

    CONSTRAINT "EmotionalBaseline_pkey" PRIMARY KEY ("personaId")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "memoryType" "MemoryType" NOT NULL,
    "memorySubtype" VARCHAR(50),
    "contentType" VARCHAR(50),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3),
    "embedding" vector(768),
    "searchText" TEXT,
    "searchVector" tsvector,
    "emotionalStateId" UUID,
    "significanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidenceLevel" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessed" TIMESTAMP(3),
    "consolidationState" "ConsolidationState" NOT NULL DEFAULT 'labile',
    "memoryStrength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "decayRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "realityType" VARCHAR(50) NOT NULL DEFAULT 'experienced',
    "sourceEntityId" UUID,
    "referencedStates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channel" VARCHAR(100),

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryContentEpisodic" (
    "memoryId" UUID NOT NULL,
    "eventType" VARCHAR(100),
    "location" VARCHAR(200),
    "durationMinutes" INTEGER,
    "whatHappened" TEXT NOT NULL,
    "whySignificant" TEXT,
    "lessonLearned" TEXT,
    "visualDetails" TEXT,
    "auditoryDetails" TEXT,
    "tactileDetails" TEXT,
    "olfactoryDetails" TEXT,
    "gustatoryDetails" TEXT,
    "enhancedSensoryDetails" JSONB,
    "voiceNotes" TEXT,

    CONSTRAINT "MemoryContentEpisodic_pkey" PRIMARY KEY ("memoryId")
);

-- CreateTable
CREATE TABLE "MemoryContentSemantic" (
    "memoryId" UUID NOT NULL,
    "factType" VARCHAR(50),
    "factCategory" VARCHAR(100),
    "statement" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" VARCHAR(100),
    "supportingEvidence" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "MemoryContentSemantic_pkey" PRIMARY KEY ("memoryId")
);

-- CreateTable
CREATE TABLE "MemoryContentProcedural" (
    "memoryId" UUID NOT NULL,
    "skillName" VARCHAR(100) NOT NULL,
    "skillCategory" VARCHAR(50),
    "proficiencyLevel" INTEGER,
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastPracticed" TIMESTAMP(3),
    "practiceCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MemoryContentProcedural_pkey" PRIMARY KEY ("memoryId")
);

-- CreateTable
CREATE TABLE "MemoryParticipant" (
    "memoryId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "role" VARCHAR(50) NOT NULL,

    CONSTRAINT "MemoryParticipant_pkey" PRIMARY KEY ("memoryId","entityId")
);

-- CreateTable
CREATE TABLE "MemoryConsolidation" (
    "memoryId" UUID NOT NULL,
    "initialStrength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "currentStrength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "lastReactivation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reactivationCount" INTEGER NOT NULL DEFAULT 0,
    "inReconsolidation" BOOLEAN NOT NULL DEFAULT false,
    "windowOpenedAt" TIMESTAMP(3),
    "reinforcingMemories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conflictingMemories" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "MemoryConsolidation_pkey" PRIMARY KEY ("memoryId")
);

-- CreateTable
CREATE TABLE "MemoryAssociation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "memoryA" UUID NOT NULL,
    "memoryB" UUID NOT NULL,
    "associationType" VARCHAR(50) NOT NULL,
    "associationStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryAssociation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbodiedMemory" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "memoryId" UUID NOT NULL,
    "somaticSensation" TEXT NOT NULL,
    "bodyLocation" VARCHAR(100) NOT NULL,
    "sensationIntensity" DOUBLE PRECISION NOT NULL,
    "triggerType" VARCHAR(50) NOT NULL,
    "automaticResponse" TEXT NOT NULL,
    "canConsciouslyOverride" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EmbodiedMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyPart" (
    "id" SERIAL NOT NULL,
    "partName" VARCHAR(50) NOT NULL,
    "partCategory" VARCHAR(50),
    "parentPartId" INTEGER,

    CONSTRAINT "BodyPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalAttribute" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "bodyPartId" INTEGER,
    "attributeType" VARCHAR(50) NOT NULL,
    "attributeValue" VARCHAR(200) NOT NULL,
    "isPermanent" BOOLEAN NOT NULL DEFAULT true,
    "context" VARCHAR(100),

    CONSTRAINT "PhysicalAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyLanguageState" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "fullBodyDescription" TEXT,
    "gaitStyle" TEXT,
    "characteristicSequence" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "BodyLanguageState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyLanguageComponent" (
    "bodyLanguageStateId" UUID NOT NULL,
    "bodyPartId" INTEGER NOT NULL,
    "position" VARCHAR(100) NOT NULL,
    "tensionLevel" DOUBLE PRECISION,
    "movementPattern" VARCHAR(100),

    CONSTRAINT "BodyLanguageComponent_pkey" PRIMARY KEY ("bodyLanguageStateId","bodyPartId")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "channel" VARCHAR(100) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "topicSummary" TEXT,
    "emotionalArc" JSONB,
    "messageCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "conversationId" UUID NOT NULL,
    "senderType" VARCHAR(20) NOT NULL,
    "senderId" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" TEXT NOT NULL,
    "contentType" VARCHAR(20) NOT NULL DEFAULT 'text',
    "detectedEmotion" VARCHAR(50),
    "isSignificant" BOOLEAN NOT NULL DEFAULT false,
    "searchVector" tsvector,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeechPattern" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "patternType" VARCHAR(50) NOT NULL,
    "textPattern" TEXT NOT NULL,
    "frequency" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "emotionalContexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "socialContexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variations" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "SpeechPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinguisticMarker" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "markerType" VARCHAR(50) NOT NULL,
    "markerDescription" TEXT NOT NULL,
    "exampleUsage" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "frequency" DOUBLE PRECISION NOT NULL DEFAULT 0.5,

    CONSTRAINT "LinguisticMarker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "relationshipType" VARCHAR(50) NOT NULL,
    "powerDynamic" "PowerDynamic" NOT NULL,
    "trustLevel" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "intimacyLevel" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "comfortLevel" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "typicalGreeting" TEXT,
    "farewellStyle" TEXT,
    "petNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "insideJokes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sharedSecrets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "boundaries" JSONB NOT NULL DEFAULT '{}',
    "topicsToAvoid" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "voiceAdjustments" JSONB,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'active',
    "establishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInteraction" TIMESTAMP(3),

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SomaticResponse" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "entityId" UUID,
    "relationshipId" UUID,
    "triggerContext" VARCHAR(100) NOT NULL,
    "physicalResponse" TEXT NOT NULL,
    "intensity" DOUBLE PRECISION NOT NULL,
    "lastTriggered" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SomaticResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClothingType" (
    "id" SERIAL NOT NULL,
    "typeName" VARCHAR(50) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "typicalLayer" INTEGER,

    CONSTRAINT "ClothingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClothingItem" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "clothingTypeId" INTEGER,
    "name" VARCHAR(100) NOT NULL,
    "primaryColor" VARCHAR(50),
    "secondaryColors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "material" VARCHAR(50),
    "pattern" VARCHAR(50),
    "condition" VARCHAR(50) NOT NULL DEFAULT 'good',
    "acquiredDate" DATE,
    "acquiredContext" TEXT,
    "sentimentalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ClothingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outfit" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "appropriateContexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastWorn" TIMESTAMP(3),
    "associatedMood" VARCHAR(50),

    CONSTRAINT "Outfit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutfitComposition" (
    "outfitId" UUID NOT NULL,
    "clothingItemId" UUID NOT NULL,

    CONSTRAINT "OutfitComposition_pkey" PRIMARY KEY ("outfitId","clothingItemId")
);

-- CreateTable
CREATE TABLE "Accessory" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "accessoryType" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "material" VARCHAR(50),
    "wornLocation" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "significance" TEXT,
    "acquiredContext" TEXT,

    CONSTRAINT "Accessory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityTrait" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "traitCategory" VARCHAR(50) NOT NULL,
    "traitName" VARCHAR(100) NOT NULL,
    "baselineValue" DOUBLE PRECISION NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL,
    "isCoreTrait" BOOLEAN NOT NULL DEFAULT false,
    "flexibility" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalityTrait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityEvolution" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "snapshotTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personalityProfile" JSONB NOT NULL,
    "emotionalBaselines" JSONB NOT NULL,
    "changesFromPrevious" JSONB,
    "changeDrivers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consistencyScore" DOUBLE PRECISION,
    "driftDetected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PersonalityEvolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifeEvent" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "eventType" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "ageOccurred" INTEGER,
    "dateOccurred" DATE,
    "lifeImpactScore" INTEGER NOT NULL,
    "shapesTraits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "disclosureLevel" VARCHAR(50) NOT NULL,
    "toldTo" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "LifeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesireCategory" (
    "id" SERIAL NOT NULL,
    "level" INTEGER NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,

    CONSTRAINT "DesireCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Desire" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "desireCategoryId" INTEGER,
    "desireDescription" TEXT NOT NULL,
    "currentIntensity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "fulfillmentLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fulfillmentConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "partiallyFulfilledBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "sharedWith" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Desire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoundaryType" (
    "id" SERIAL NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,

    CONSTRAINT "BoundaryType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Boundary" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "boundaryTypeId" INTEGER,
    "boundaryDescription" TEXT NOT NULL,
    "firmness" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "appliesToEntityId" UUID,
    "contextSpecific" VARCHAR(100),
    "violationResponse" TEXT,
    "timesTested" INTEGER NOT NULL DEFAULT 0,
    "timesHeld" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Boundary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preference" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "preferenceCategory" VARCHAR(50) NOT NULL,
    "specificItem" VARCHAR(200) NOT NULL,
    "preferenceType" VARCHAR(20) NOT NULL,
    "intensity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "formedThroughMemoryId" UUID,
    "contextBoosters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contextDampeners" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DreamAspiration" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "dreamType" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "perceivedAchievability" DOUBLE PRECISION NOT NULL,
    "stepsTaken" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "obstacles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sharedWith" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importance" DOUBLE PRECISION NOT NULL,
    "givesHope" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DreamAspiration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetacognitiveProcess" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "processType" VARCHAR(50) NOT NULL,
    "topic" TEXT NOT NULL,
    "thoughtContent" TEXT NOT NULL,
    "metaThought" TEXT NOT NULL,
    "reflectionDepth" INTEGER NOT NULL,
    "selfAwarenessScore" DOUBLE PRECISION NOT NULL,
    "biasRecognition" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "identifiedContradictions" JSONB NOT NULL DEFAULT '[]',
    "resolutionAttempted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetacognitiveProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfDiscovery" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "discoveryContent" TEXT NOT NULL,
    "discoveredThrough" TEXT NOT NULL,
    "changedBeliefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "changedBehaviors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emotionalImpact" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InnerConflict" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "conflictDescription" TEXT NOT NULL,
    "sideA" TEXT NOT NULL,
    "sideB" TEXT NOT NULL,
    "currentBalance" DOUBLE PRECISION NOT NULL,
    "behavioralManifestations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attemptedResolutions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stillActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InnerConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaState" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "stateKey" VARCHAR(100) NOT NULL,
    "stateValue" JSONB NOT NULL,
    "valueType" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateCount" INTEGER NOT NULL DEFAULT 0,
    "isConsciousOf" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PersonaState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaStateChange" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "stateId" UUID NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggerType" VARCHAR(50) NOT NULL,
    "triggerDetails" JSONB,
    "relatedMemoryId" UUID,

    CONSTRAINT "PersonaStateChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopingMechanism" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "stressorType" VARCHAR(100) NOT NULL,
    "copingStrategy" TEXT NOT NULL,
    "effectiveness" DOUBLE PRECISION NOT NULL,
    "physicalActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isHealthy" BOOLEAN NOT NULL,
    "tryingToChange" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CopingMechanism_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensoryExperience" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "senseType" VARCHAR(50) NOT NULL,
    "sensitivityLevel" DOUBLE PRECISION NOT NULL,
    "pleasantStimuli" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unpleasantStimuli" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "behavioralResponses" JSONB,

    CONSTRAINT "SensoryExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityRelationship" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "aspect" VARCHAR(100) NOT NULL,
    "acceptanceLevel" DOUBLE PRECISION NOT NULL,
    "prideShameSpectrum" DOUBLE PRECISION NOT NULL,
    "pastExperiences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hidesFromSome" BOOLEAN NOT NULL DEFAULT false,
    "embracesWithOthers" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "IdentityRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_LifeEventToldTo" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_LifeEventToldTo_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_DesireSharedWith" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_DesireSharedWith_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_DreamSharedWith" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_DreamSharedWith_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdentityComponent_personaId_componentType_content_key" ON "IdentityComponent"("personaId", "componentType", "content");

-- CreateIndex
CREATE UNIQUE INDEX "EmotionType_emotionName_key" ON "EmotionType"("emotionName");

-- CreateIndex
CREATE INDEX "Memory_personaId_memoryType_idx" ON "Memory"("personaId", "memoryType");

-- CreateIndex
CREATE INDEX "Memory_personaId_occurredAt_idx" ON "Memory"("personaId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Memory_personaId_significanceScore_idx" ON "Memory"("personaId", "significanceScore" DESC);

-- CreateIndex
CREATE INDEX "Memory_personaId_createdAt_idx" ON "Memory"("personaId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Memory_emotionalStateId_createdAt_idx" ON "Memory"("emotionalStateId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Memory_personaId_contentType_createdAt_idx" ON "Memory"("personaId", "contentType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MemoryAssociation_memoryA_associationStrength_idx" ON "MemoryAssociation"("memoryA", "associationStrength" DESC);

-- CreateIndex
CREATE INDEX "MemoryAssociation_memoryB_associationStrength_idx" ON "MemoryAssociation"("memoryB", "associationStrength" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "MemoryAssociation_memoryA_memoryB_key" ON "MemoryAssociation"("memoryA", "memoryB");

-- CreateIndex
CREATE UNIQUE INDEX "BodyPart_partName_key" ON "BodyPart"("partName");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalAttribute_personaId_bodyPartId_attributeType_contex_key" ON "PhysicalAttribute"("personaId", "bodyPartId", "attributeType", "context");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_personaId_entityId_channel_startedAt_key" ON "Conversation"("personaId", "entityId", "channel", "startedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_timestamp_idx" ON "Message"("conversationId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_personaId_entityId_key" ON "Relationship"("personaId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ClothingType_typeName_key" ON "ClothingType"("typeName");

-- CreateIndex
CREATE UNIQUE INDEX "DesireCategory_name_key" ON "DesireCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BoundaryType_name_key" ON "BoundaryType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Preference_personaId_preferenceCategory_specificItem_key" ON "Preference"("personaId", "preferenceCategory", "specificItem");

-- CreateIndex
CREATE INDEX "PersonaState_personaId_stateKey_idx" ON "PersonaState"("personaId", "stateKey");

-- CreateIndex
CREATE INDEX "PersonaState_lastUpdated_idx" ON "PersonaState"("lastUpdated" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PersonaState_personaId_stateKey_key" ON "PersonaState"("personaId", "stateKey");

-- CreateIndex
CREATE INDEX "_LifeEventToldTo_B_index" ON "_LifeEventToldTo"("B");

-- CreateIndex
CREATE INDEX "_DesireSharedWith_B_index" ON "_DesireSharedWith"("B");

-- CreateIndex
CREATE INDEX "_DreamSharedWith_B_index" ON "_DreamSharedWith"("B");

-- AddForeignKey
ALTER TABLE "IdentityComponent" ADD CONSTRAINT "IdentityComponent_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionalStateComponent" ADD CONSTRAINT "EmotionalStateComponent_emotionalStateId_fkey" FOREIGN KEY ("emotionalStateId") REFERENCES "EmotionalState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionalStateComponent" ADD CONSTRAINT "EmotionalStateComponent_emotionTypeId_fkey" FOREIGN KEY ("emotionTypeId") REFERENCES "EmotionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionalBaseline" ADD CONSTRAINT "EmotionalBaseline_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_emotionalStateId_fkey" FOREIGN KEY ("emotionalStateId") REFERENCES "EmotionalState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryContentEpisodic" ADD CONSTRAINT "MemoryContentEpisodic_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryContentSemantic" ADD CONSTRAINT "MemoryContentSemantic_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryContentProcedural" ADD CONSTRAINT "MemoryContentProcedural_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryParticipant" ADD CONSTRAINT "MemoryParticipant_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryParticipant" ADD CONSTRAINT "MemoryParticipant_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryConsolidation" ADD CONSTRAINT "MemoryConsolidation_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAssociation" ADD CONSTRAINT "MemoryAssociation_memoryA_fkey" FOREIGN KEY ("memoryA") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAssociation" ADD CONSTRAINT "MemoryAssociation_memoryB_fkey" FOREIGN KEY ("memoryB") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbodiedMemory" ADD CONSTRAINT "EmbodiedMemory_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyPart" ADD CONSTRAINT "BodyPart_parentPartId_fkey" FOREIGN KEY ("parentPartId") REFERENCES "BodyPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalAttribute" ADD CONSTRAINT "PhysicalAttribute_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalAttribute" ADD CONSTRAINT "PhysicalAttribute_bodyPartId_fkey" FOREIGN KEY ("bodyPartId") REFERENCES "BodyPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyLanguageState" ADD CONSTRAINT "BodyLanguageState_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyLanguageComponent" ADD CONSTRAINT "BodyLanguageComponent_bodyLanguageStateId_fkey" FOREIGN KEY ("bodyLanguageStateId") REFERENCES "BodyLanguageState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyLanguageComponent" ADD CONSTRAINT "BodyLanguageComponent_bodyPartId_fkey" FOREIGN KEY ("bodyPartId") REFERENCES "BodyPart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeechPattern" ADD CONSTRAINT "SpeechPattern_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinguisticMarker" ADD CONSTRAINT "LinguisticMarker_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SomaticResponse" ADD CONSTRAINT "SomaticResponse_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SomaticResponse" ADD CONSTRAINT "SomaticResponse_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SomaticResponse" ADD CONSTRAINT "SomaticResponse_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingItem" ADD CONSTRAINT "ClothingItem_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClothingItem" ADD CONSTRAINT "ClothingItem_clothingTypeId_fkey" FOREIGN KEY ("clothingTypeId") REFERENCES "ClothingType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outfit" ADD CONSTRAINT "Outfit_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitComposition" ADD CONSTRAINT "OutfitComposition_outfitId_fkey" FOREIGN KEY ("outfitId") REFERENCES "Outfit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitComposition" ADD CONSTRAINT "OutfitComposition_clothingItemId_fkey" FOREIGN KEY ("clothingItemId") REFERENCES "ClothingItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accessory" ADD CONSTRAINT "Accessory_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalityTrait" ADD CONSTRAINT "PersonalityTrait_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalityEvolution" ADD CONSTRAINT "PersonalityEvolution_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeEvent" ADD CONSTRAINT "LifeEvent_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Desire" ADD CONSTRAINT "Desire_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Desire" ADD CONSTRAINT "Desire_desireCategoryId_fkey" FOREIGN KEY ("desireCategoryId") REFERENCES "DesireCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boundary" ADD CONSTRAINT "Boundary_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boundary" ADD CONSTRAINT "Boundary_boundaryTypeId_fkey" FOREIGN KEY ("boundaryTypeId") REFERENCES "BoundaryType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boundary" ADD CONSTRAINT "Boundary_appliesToEntityId_fkey" FOREIGN KEY ("appliesToEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_formedThroughMemoryId_fkey" FOREIGN KEY ("formedThroughMemoryId") REFERENCES "Memory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DreamAspiration" ADD CONSTRAINT "DreamAspiration_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetacognitiveProcess" ADD CONSTRAINT "MetacognitiveProcess_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfDiscovery" ADD CONSTRAINT "SelfDiscovery_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InnerConflict" ADD CONSTRAINT "InnerConflict_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaState" ADD CONSTRAINT "PersonaState_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaStateChange" ADD CONSTRAINT "PersonaStateChange_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "PersonaState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaStateChange" ADD CONSTRAINT "PersonaStateChange_relatedMemoryId_fkey" FOREIGN KEY ("relatedMemoryId") REFERENCES "Memory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopingMechanism" ADD CONSTRAINT "CopingMechanism_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensoryExperience" ADD CONSTRAINT "SensoryExperience_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRelationship" ADD CONSTRAINT "IdentityRelationship_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LifeEventToldTo" ADD CONSTRAINT "_LifeEventToldTo_A_fkey" FOREIGN KEY ("A") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LifeEventToldTo" ADD CONSTRAINT "_LifeEventToldTo_B_fkey" FOREIGN KEY ("B") REFERENCES "LifeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DesireSharedWith" ADD CONSTRAINT "_DesireSharedWith_A_fkey" FOREIGN KEY ("A") REFERENCES "Desire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DesireSharedWith" ADD CONSTRAINT "_DesireSharedWith_B_fkey" FOREIGN KEY ("B") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DreamSharedWith" ADD CONSTRAINT "_DreamSharedWith_A_fkey" FOREIGN KEY ("A") REFERENCES "DreamAspiration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DreamSharedWith" ADD CONSTRAINT "_DreamSharedWith_B_fkey" FOREIGN KEY ("B") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
