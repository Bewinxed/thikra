/*
  Warnings:

  - You are about to drop the column `context` on the `PersonalityObservation` table. All the data in the column will be lost.
  - You are about to drop the column `triggerDetail` on the `PersonalityParameterHistory` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PersonalityObservation" DROP COLUMN "context",
ADD COLUMN     "emotionalStateId" UUID,
ADD COLUMN     "interactionPartnerId" UUID,
ADD COLUMN     "situation" TEXT,
ADD COLUMN     "trigger" TEXT;

-- AlterTable
ALTER TABLE "PersonalityParameterHistory" DROP COLUMN "triggerDetail",
ADD COLUMN     "attractorDrift" DOUBLE PRECISION,
ADD COLUMN     "baselineDrift" DOUBLE PRECISION,
ADD COLUMN     "driftSignificance" DOUBLE PRECISION,
ADD COLUMN     "variabilityDrift" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PersonalityObservationEvidence" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "observationId" UUID NOT NULL,
    "evidence" TEXT NOT NULL,
    "evidenceType" VARCHAR(50) NOT NULL,

    CONSTRAINT "PersonalityObservationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalityObservationEvidence_observationId_idx" ON "PersonalityObservationEvidence"("observationId");

-- CreateIndex
CREATE INDEX "PersonalityObservation_personaId_situation_idx" ON "PersonalityObservation"("personaId", "situation");

-- CreateIndex
CREATE INDEX "PersonalityObservation_personaId_interactionPartnerId_idx" ON "PersonalityObservation"("personaId", "interactionPartnerId");

-- AddForeignKey
ALTER TABLE "PersonalityObservation" ADD CONSTRAINT "PersonalityObservation_interactionPartnerId_fkey" FOREIGN KEY ("interactionPartnerId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalityObservation" ADD CONSTRAINT "PersonalityObservation_emotionalStateId_fkey" FOREIGN KEY ("emotionalStateId") REFERENCES "EmotionalState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalityObservationEvidence" ADD CONSTRAINT "PersonalityObservationEvidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "PersonalityObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
