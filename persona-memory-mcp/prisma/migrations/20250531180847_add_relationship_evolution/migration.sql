-- CreateTable
CREATE TABLE "RelationshipEvolution" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "relationshipId" UUID NOT NULL,
    "trustDelta" DOUBLE PRECISION,
    "intimacyDelta" DOUBLE PRECISION,
    "attractionDelta" DOUBLE PRECISION,
    "triggerMemoryId" UUID NOT NULL,
    "changeReason" VARCHAR(100) NOT NULL,
    "padPleasure" DOUBLE PRECISION,
    "padArousal" DOUBLE PRECISION,
    "padDominance" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipEvolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipSummary" (
    "relationshipId" UUID NOT NULL,
    "currentTrust" DOUBLE PRECISION NOT NULL,
    "currentIntimacy" DOUBLE PRECISION NOT NULL,
    "currentAttraction" DOUBLE PRECISION NOT NULL,
    "trustTrend" VARCHAR(20) NOT NULL,
    "stabilityPattern" VARCHAR(20) NOT NULL,
    "relationshipPhase" VARCHAR(20) NOT NULL,
    "lastSignificantChange" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationshipSummary_pkey" PRIMARY KEY ("relationshipId")
);

-- CreateIndex
CREATE INDEX "RelationshipEvolution_relationshipId_timestamp_idx" ON "RelationshipEvolution"("relationshipId", "timestamp");

-- CreateIndex
CREATE INDEX "RelationshipEvolution_triggerMemoryId_idx" ON "RelationshipEvolution"("triggerMemoryId");

-- AddForeignKey
ALTER TABLE "RelationshipEvolution" ADD CONSTRAINT "RelationshipEvolution_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipEvolution" ADD CONSTRAINT "RelationshipEvolution_triggerMemoryId_fkey" FOREIGN KEY ("triggerMemoryId") REFERENCES "Memory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipSummary" ADD CONSTRAINT "RelationshipSummary_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
