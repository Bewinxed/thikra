/*
  Warnings:

  - You are about to drop the `PersonalityEvolution` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PersonalityEvolution" DROP CONSTRAINT "PersonalityEvolution_personaId_fkey";

-- DropTable
DROP TABLE "PersonalityEvolution";

-- CreateTable
CREATE TABLE "PersonalityObservation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "traitDimension" VARCHAR(100) NOT NULL,
    "observedValue" DOUBLE PRECISION NOT NULL,
    "context" JSONB,
    "sourceMemoryId" UUID,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalityObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityParameter" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "personaId" UUID NOT NULL,
    "traitDimension" VARCHAR(100) NOT NULL,
    "baseline" DOUBLE PRECISION NOT NULL,
    "variability" DOUBLE PRECISION NOT NULL,
    "attractorForce" DOUBLE PRECISION NOT NULL,
    "baselineUncertainty" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "variabilityUncertainty" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "attractorUncertainty" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalityParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityParameterHistory" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "parameterId" UUID NOT NULL,
    "baseline" DOUBLE PRECISION NOT NULL,
    "variability" DOUBLE PRECISION NOT NULL,
    "attractorForce" DOUBLE PRECISION NOT NULL,
    "triggerType" VARCHAR(50) NOT NULL,
    "triggerDetail" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalityParameterHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalityObservation_personaId_traitDimension_observedAt_idx" ON "PersonalityObservation"("personaId", "traitDimension", "observedAt");

-- CreateIndex
CREATE INDEX "PersonalityParameter_personaId_idx" ON "PersonalityParameter"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalityParameter_personaId_traitDimension_key" ON "PersonalityParameter"("personaId", "traitDimension");

-- CreateIndex
CREATE INDEX "PersonalityParameterHistory_parameterId_recordedAt_idx" ON "PersonalityParameterHistory"("parameterId", "recordedAt");

-- AddForeignKey
ALTER TABLE "PersonalityObservation" ADD CONSTRAINT "PersonalityObservation_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalityObservation" ADD CONSTRAINT "PersonalityObservation_sourceMemoryId_fkey" FOREIGN KEY ("sourceMemoryId") REFERENCES "Memory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalityParameter" ADD CONSTRAINT "PersonalityParameter_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalityParameterHistory" ADD CONSTRAINT "PersonalityParameterHistory_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "PersonalityParameter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
