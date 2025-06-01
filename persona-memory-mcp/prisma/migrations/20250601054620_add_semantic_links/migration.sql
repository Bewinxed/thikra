-- CreateEnum
CREATE TYPE "SemanticSourceType" AS ENUM ('memory', 'emotion', 'personality', 'relationship', 'entity', 'state');

-- CreateTable
CREATE TABLE "SemanticLink" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "embedding" vector(768) NOT NULL,
    "personaId" UUID NOT NULL,
    "sourceType" "SemanticSourceType" NOT NULL,
    "sourceId" UUID NOT NULL,
    "contextEntityId" UUID,
    "temporalContext" tsrange,
    "participantEntityIds" UUID[],
    "emotionalContextId" UUID,
    "relationshipContextIds" UUID[],
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "relevanceDecay" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SemanticLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SemanticLink_personaId_sourceType_sourceId_idx" ON "SemanticLink"("personaId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "semantic_link_embedding_HNSW" ON "SemanticLink"("embedding");

-- CreateIndex
CREATE INDEX "SemanticLink_personaId_contextEntityId_idx" ON "SemanticLink"("personaId", "contextEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticLink_personaId_sourceType_sourceId_key" ON "SemanticLink"("personaId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "SemanticLink" ADD CONSTRAINT "SemanticLink_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticLink" ADD CONSTRAINT "SemanticLink_contextEntityId_fkey" FOREIGN KEY ("contextEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticLink" ADD CONSTRAINT "SemanticLink_emotionalContextId_fkey" FOREIGN KEY ("emotionalContextId") REFERENCES "EmotionalState"("id") ON DELETE SET NULL ON UPDATE CASCADE;
