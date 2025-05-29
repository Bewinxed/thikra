/*
  Warnings:

  - A unique constraint covering the columns `[memoryA,memoryB,associationType]` on the table `MemoryAssociation` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "MemoryAssociation_memoryA_memoryB_key";

-- CreateIndex
CREATE UNIQUE INDEX "MemoryAssociation_memoryA_memoryB_associationType_key" ON "MemoryAssociation"("memoryA", "memoryB", "associationType");
