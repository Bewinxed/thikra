/*
  Warnings:

  - You are about to drop the `MemoryAssociation` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "MemoryAssociation" DROP CONSTRAINT "MemoryAssociation_memoryA_fkey";

-- DropForeignKey
ALTER TABLE "MemoryAssociation" DROP CONSTRAINT "MemoryAssociation_memoryB_fkey";

-- DropTable
DROP TABLE "MemoryAssociation";

-- CreateTable
CREATE TABLE "memory_associations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "memoryA" UUID NOT NULL,
    "memoryB" UUID NOT NULL,
    "associationType" VARCHAR(50) NOT NULL,
    "associationStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_associations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_associations_memoryA_associationStrength_idx" ON "memory_associations"("memoryA", "associationStrength" DESC);

-- CreateIndex
CREATE INDEX "memory_associations_memoryB_associationStrength_idx" ON "memory_associations"("memoryB", "associationStrength" DESC);

-- CreateIndex
CREATE INDEX "memory_associations_memoryA_memoryB_idx" ON "memory_associations"("memoryA", "memoryB");

-- CreateIndex
CREATE UNIQUE INDEX "memory_associations_memoryA_memoryB_associationType_key" ON "memory_associations"("memoryA", "memoryB", "associationType");

-- AddForeignKey
ALTER TABLE "memory_associations" ADD CONSTRAINT "memory_associations_memoryA_fkey" FOREIGN KEY ("memoryA") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_associations" ADD CONSTRAINT "memory_associations_memoryB_fkey" FOREIGN KEY ("memoryB") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
