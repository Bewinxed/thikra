-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Set up text search configuration
CREATE TEXT SEARCH CONFIGURATION persona_search (COPY = english);

-- Grant necessary permissions
GRANT ALL PRIVILEGES ON DATABASE persona_memory TO persona_user;