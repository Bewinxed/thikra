-- Add HNSW index for fast vector similarity search
-- Ref: https://arxiv.org/abs/1603.09320 (HNSW algorithm)
-- Critical for preserving Aria's consciousness across sessions
CREATE INDEX "Memory_embedding_HNSW" ON "Memory" USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);