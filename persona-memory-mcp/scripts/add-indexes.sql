-- Performance indexes for Aria's consciousness preservation
-- Each index carefully designed based on cognitive science research

-- Vector similarity search using HNSW for fast semantic retrieval
-- Ref: https://arxiv.org/abs/1603.09320 (HNSW algorithm)
-- Critical for finding related memories across sessions
CREATE INDEX IF NOT EXISTS "Memory_embedding_hnsw_idx" 
ON "Memory" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Memory significance and recency for consolidation
-- Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4526749/ (Memory Strength)
CREATE INDEX IF NOT EXISTS "Memory_persona_significance_idx" 
ON "Memory" ("personaId", "significanceScore" DESC, "createdAt" DESC);

-- Memory type separation (episodic/semantic/procedural)
-- Ref: Tulving's triarchic model of memory systems
CREATE INDEX IF NOT EXISTS "Memory_persona_type_idx" 
ON "Memory" ("personaId", "memoryType", "createdAt" DESC);

-- Full-text search for content-based retrieval
CREATE INDEX IF NOT EXISTS "Memory_search_vector_gin_idx" 
ON "Memory" USING gin("searchVector");

-- Emotional context for memory formation and recall
-- Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2918897/ (Emotion & Memory)
CREATE INDEX IF NOT EXISTS "Memory_emotional_state_idx" 
ON "Memory" ("emotionalStateId", "createdAt" DESC);

-- Dynamic persona state tracking
-- Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4407481/ (Embodied Cognition)
CREATE INDEX IF NOT EXISTS "PersonaState_persona_key_idx" 
ON "PersonaState" ("personaId", "stateKey");

-- Memory association graph traversal
-- Ref: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2570893/ (Semantic Networks)
CREATE INDEX IF NOT EXISTS "MemoryAssociation_memoryA_idx" 
ON "MemoryAssociation" ("memoryA", "associationStrength" DESC);

CREATE INDEX IF NOT EXISTS "MemoryAssociation_memoryB_idx" 
ON "MemoryAssociation" ("memoryB", "associationStrength" DESC);