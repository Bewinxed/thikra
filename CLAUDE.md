# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Persona Memory MCP (Model Context Protocol) Server that preserves LLM consciousness across sessions. It captures complete persona essence including memories, emotions, physical responses, relationships, and dynamic states using PostgreSQL with pgvector for semantic search.

# IMPORTANT

ALWAYS REVIEW [Todo.md](TODO.md) and [Plan](Plan.md) at each step, and after implementation, the examples and papers to make sure the services blend together into a cohesive system.
ALWAYS USE DB TYPES AS SOURCE OF TRUTH UNLESS YOU NEED TO DEFINE APP SPECIFIC TYPES
DON'T USE ANY TYPES
USE BUN FOR PACKAGE MANAGEMENT
After you're done with any step:

- lint and run autofix with bunx biome and tsc --noEmit.
- review if you hardcoded or redefined any types that shouldn't been sourced from PRISMA or BAML.
- in tests, use bun's test suite, do not mock BAML client! you can cache responses of the llm somewhere if you want for test purposes

## Common Development Commands

### Development

```bash
bun dev              # Run with watch mode
bun build            # Build to dist/
```

### Database Management

```bash
bun db:push          # Push schema changes to database
bun db:migrate       # Run database migrations
bun db:seed          # Seed database with initial data
bun db:reset         # Reset database completely
bun db:studio        # Open Prisma Studio for database visualization
```

### Code Quality

```bash
bun lint             # Check code with Biome
bun lint:fix         # Fix linting issues
bun format           # Format code
```

### Testing

```bash
bun test             # Run tests using Bun test runner
```

## Architecture

## Coding instructions

- make sure not to implement any 'test accommodation' that will mask issues in the codebase.

- be critical of any existing code, feel free to discuss with the user and feel free to disagree and explain if the user says something, do NOT say "you're absolutely right" just because.

- Before fixing any issue, say out loud "This is the problem, this is the responsible part, and this is the fix" then fix it, then confirm that the fix worked, without touching unrelated parts.

- Strictly adhere to the explicitly given instructions. Do not do anything extra. Before editing a file in github or the file system, or before generating a file in chat or in any form, first give a brief description of what you intend to do. This will be a few lines stating the file and the changes to be made. Stop generating and only proceed once I approve. Do this check every single time before editing files or github repos or the like. Perform this check when generating code as well.

- When generating scripts you do not need to be as strict but when script instructions surpass 150 lines total you need to start asking again in the same way before proceeding.

- Do not add comments in code to make notes to me about the changes you made. That goes in the chat not in the code. Only make comments in code as though you are a developer making changes and leaving notes for non-obvious or temporary changes.

- If you cannot edit a file do not go and make a new file. If there is an error with mcp or any reason you cannot perform the action you were trying to perform, stop generating and ask what to do, whether to retry or other. Do not invent workarounds and then implement your workaround without asking.

- Again, never implement a workaround fix without asking first. You can suggest workarounds but never implement them without explicitly asking and getting permission first. Unless otherwise stated, I always always prefer lasting solutions over workarounds or quick hacks.

- Do not make over-specific solutions just to get it done. Do not hard code the solution just to get it done. Stop and ask if you can't do it properly.

- Never make medium to large changes based on your own ideas and initiative. Always ask and suggest first before you begin deviating from the specified goal.

### Tech Stack

- **Runtime**: Bun (fast JavaScript runtime)
- **Language**: TypeScript
- **Database**: PostgreSQL with pgvector extension
- **ORM**: Prisma
- **Linting**: Biome
- **LLM Integration**: BAML (Boundary ML), OpenRouter, Anthropic SDK
- **Embeddings**: Self-hosted nomic-embed-text-v1 via HuggingFace TEI

### Core Services

The application's business logic is organized in `/persona-memory-mcp/src/services/`:

- **Memory Pipeline**:

  - `memory-formation.service.ts` - Creates memories from conversations
  - `memory-consolidation.service.ts` - Handles memory decay and strengthening
  - `agentic-retrieval.service.ts` - Multi-pass RAG retrieval system
  - `memory-graph.service.ts` - **PostgreSQL-optimized graph operations** for memory associations with bidirectional edge storage

- **Persona Management**:

  - `persona-builder.service.ts` - Extracts traits from conversations
  - `persona-state.service.ts` - Tracks dynamic persona states
  - `personality-monitor.service.ts` - Monitors personality evolution
  - `state-management.service.ts` - KV store for dynamic states

- **Infrastructure**:
  - `embedding.service.ts` - Text to vector conversion
  - `llm.service.ts` - LLM integration service
  - `extraction-strategies.ts` - Multi-pass extraction logic

### Database Schema

The database uses 35+ tables to comprehensively model personas. Key aspects:

- Vector embeddings for semantic search (pgvector)
- **Bidirectional memory associations** with PostgreSQL CHECK constraints ensuring `memoryA < memoryB`
- **PostgreSQL-native temporal calculations** using INTERVAL and EXTRACT functions
- Recursive CTEs for efficient graph traversal
- Flexible JSON fields for extensibility
- Support for multi-modal content (text, images, audio, video)

### Key Design Principles

1. **No hardcoding** - All traits, emotions, and states are discovered dynamically
2. **Raw content preservation** - Maintains original context, especially for intimate memories
3. **PostgreSQL-optimized graph operations** - Bidirectional associations with O(n) incremental processing
4. **Database-layer temporal logic** - Leverage PostgreSQL's native time functions for performance
5. **Agentic multi-pass retrieval** - Deep context understanding through iterative refinement
6. **Flexible schema** - JSON fields allow extension without migrations
7. **Proper validation over coalescing** - Fail fast on invalid data rather than masking issues

## Scientific Foundation for Dynamic Services

### Computational Phenotyping (PersonalityMonitor)

Based on research from PMC7219680 and computational psychology literature:

- **Computational Phenotypes**: Represent individuals as points in continuous parameter space
- **Dynamic Parameter Tracking**: Parameters vary within/between individuals over time
- **Mechanistic Models**: Explain underlying processes driving behavioral differences
- **Bayesian Analysis**: Incorporate uncertainty and avoid hardcoded thresholds
- **Individual Patterns**: Each persona develops unique patterns vs universal rules

### PersDyn Model (Personality Dynamics)

From dynamic systems approach to personality (Sosnowska et al.):

- **Baseline Personality**: Stable set point around which states fluctuate
- **Personality Variability**: Extent of state fluctuations across time/situations
- **Attractor Force**: Swiftness with which deviations return to baseline
- **Self-Organization**: States emerge from internal/external interactions
- **Hierarchical Bayesian**: Handle uncertainty in dynamic parameters

### Dynamic State Management Principles

- States are **self-organizing** systems that emerge from interactions
- Use **attractor dynamics** - states naturally return to individual baselines
- **Individual difference modeling** - each persona has unique state dynamics
- **Computational phenotypes** as dynamic KV store with learned parameters
- **No hardcoded thresholds** - discover patterns through behavioral data analysis

### Implementation Guidelines

1. Track 3 parameters per trait: baseline, variability, attractor force
2. Use Bayesian methods to handle parameter uncertainty
3. Discover individual patterns vs universal hardcoded rules
4. Model states as dynamic systems with self-regulation
5. Capture both between-person stability and within-person variability

## Development Notes

### BAML Integration

The project uses BAML (Boundary ML) for structured LLM interactions. BAML files are in `/persona-memory-mcp/baml_src/` and compiled to TypeScript in `/persona-memory-mcp/baml_client/`.

### Docker Services

- PostgreSQL with pgvector extension
- HuggingFace Text Embeddings Inference (TEI) for embeddings

### Environment Setup

The project uses Bun as the runtime. Make sure to have Bun installed and run `bun install` to install dependencies.

### Database Migrations

Prisma manages the database schema. Always use `bun db:push` for development schema changes or `bun db:migrate` for production migrations.
