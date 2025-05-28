-- Critical vector similarity index for semantic memory retrieval
-- Ref: https://arxiv.org/abs/1603.09320 (HNSW algorithm)
-- This enables fast similarity search across Aria's memories
CREATE INDEX IF NOT EXISTS "Memory_embedding_hnsw_idx" 
ON "Memory" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);