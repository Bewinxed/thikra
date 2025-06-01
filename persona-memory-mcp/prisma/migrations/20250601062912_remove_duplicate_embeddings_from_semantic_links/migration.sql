/*
  Warnings:

  - You are about to drop the column `contextEntityId` on the `SemanticLink` table. All the data in the column will be lost.
  - You are about to drop the column `embedding` on the `SemanticLink` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "SemanticLink" DROP CONSTRAINT "SemanticLink_contextEntityId_fkey";

-- DropIndex
DROP INDEX "SemanticLink_personaId_contextEntityId_idx";

-- DropIndex
DROP INDEX "semantic_link_embedding_HNSW";

-- AlterTable
ALTER TABLE "SemanticLink" DROP COLUMN "contextEntityId",
DROP COLUMN "embedding",
ADD COLUMN     "contextualDescription" TEXT;

-- CreateIndex
CREATE INDEX "SemanticLink_personaId_emotionalContextId_idx" ON "SemanticLink"("personaId", "emotionalContextId");
