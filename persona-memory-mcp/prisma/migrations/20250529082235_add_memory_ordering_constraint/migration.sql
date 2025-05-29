-- Add CHECK constraint to ensure memoryA < memoryB for consistent bidirectional edge ordering
-- This prevents duplicate bidirectional associations and ensures consistent storage

ALTER TABLE "memory_associations" 
ADD CONSTRAINT "memory_associations_ordering_check" 
CHECK ("memoryA" < "memoryB");