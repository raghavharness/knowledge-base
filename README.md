# Ship Server

Multi-team, knowledge-driven MCP server for the Ship agent platform. The server is the **brain** — it stores resolution knowledge, finds similar past fixes, and learns from outcomes. It stores **zero external credentials**.

## Architecture

```
Developer's Machine (HANDS)              Ship Server (BRAIN)
- All credentials                        - Zero external credentials
- All code execution                     - Only stores knowledge
- All MCP servers (Atlassian,            - Only answers questions
  GitHub, Harness, Remote Shell)         - Neo4j knowledge graph
- LLM orchestrates the workflow          - JWT auth (only secret)
```

**8 MCP Tools**: `ship_register`, `ship_context`, `ship_search`, `ship_record`, `ship_feedback`, `ship_blackboard`, `ship_ingest`, `ship_ingest_status`

**3 MCP Prompts**: `ship` (full lifecycle), `ship_debug` (analysis only), `ship_ingest_jira` (bulk ingestion) — these replace the old ship skill, so no client-side skill installation is needed.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design document.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- A Google AI API key (**required** — embeddings will not work without it). Get one free at https://aistudio.google.com/apikey

### 1. Clone and configure

```bash
cd ship-server
cp .env.example .env
```

Edit `.env`:
```bash
JWT_SECRET=$(openssl rand -base64 64)    # generate a signing key
GOOGLE_API_KEY=...                       # required for embeddings
```

### 2. Start services

```bash
docker compose up -d
```

This starts:
- **Neo4j** on `localhost:7474` (browser) and `localhost:7687` (bolt)
- **Ship Server** on `localhost:3847`

### 3. Initialize the database

```bash
# If running locally (not Docker):
npm install
npm run build
npm run db:init

# If using Docker:
docker compose exec ship-server node dist/scripts/init-db.js
```

This creates:
- Neo4j constraints, vector indexes (3072-dim cosine), and full-text indexes
- Team node (ci-platform)
- Module nodes with path prefixes
- Module → Team ownership relationships

### 4. Verify

```bash
curl http://localhost:3847/health
# {"status":"ok","service":"ship-server","version":"1.0.0"}
```

## Building & Deploying

### Build everything locally

```bash
# 1. Install dependencies
npm install
cd dashboard && npm install && cd ..

# 2. Build server (TypeScript → dist/)
npm run build

# 3. Build dashboard (React → public/dashboard/)
cd dashboard && npm run build && cd ..
```

### Deploy to EC2

```bash
# 1. Build server + dashboard locally (see above)

# 2. Sync to EC2
rsync -azP --exclude node_modules --exclude .git --exclude dashboard/node_modules \
  -e "ssh -i <your-key.pem>" \
  ./ ubuntu@<ec2-host>:~/ship-server/

# 3. SSH in and rebuild Docker
ssh -i <your-key.pem> ubuntu@<ec2-host>
cd ~/ship-server
docker compose up --build -d

# 4. Verify
curl http://localhost:3847/health
```

### Database management

```bash
# Clean all data (destructive!)
docker exec <neo4j-container> cypher-shell -u neo4j -p shipagent "MATCH (n) DETACH DELETE n"

# Re-initialize schema + seed data
docker compose exec ship-server node dist/scripts/init-db.js

# Or manually create vector indexes (3072 dimensions for gemini-embedding-001)
docker exec <neo4j-container> cypher-shell -u neo4j -p shipagent \
  "CREATE VECTOR INDEX resolution_embedding IF NOT EXISTS
   FOR (r:Resolution) ON (r.embedding)
   OPTIONS {indexConfig: {\`vector.dimensions\`: 3072, \`vector.similarity_function\`: 'cosine'}}"
```

### Ingestion

Trigger bulk ingestion of PRs + JIRA tickets via the `ship_ingest_jira` MCP prompt:

```
Prompt: ship_ingest_jira
Parameters:
  token: <JWT from ship_register>
  pr_count: "100"  (optional, default 100 — number of merged PRs per repo)
```

The prompt instructs the client LLM to:
1. Discover repos from team config
2. Fetch the last N merged PRs (newest first) from GitHub and Harness Code
3. Extract linked JIRA ticket IDs from PR titles
4. Gather rich details from both JIRA and PR (6 mandatory fields: `ticket_id`, `ticket_summary`, `ticket_created_at`, `pr_url`, `pr_title`, `pr_repo`)
5. Extract analysis fields for all categories (bugfix, feature, refactor, config_change)
6. Ingest structured records via `ship_ingest`

Re-running ingestion is safe — the server upserts (updates existing records, no duplicates). `ticket_created_at` must come from JIRA's `created` field for accurate timeline data.

Patterns are created for **all categories** during ingestion — not just bugfixes. For bugfixes the pattern signature is the error message; for features/refactors/config changes it's the root cause or ticket summary.

## Local Development (without Docker)

```bash
# Start Neo4j separately (e.g., Neo4j Desktop or Docker)
docker run -d --name neo4j -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/shipagent neo4j:5.26-community

# Install and run
npm install
npm run build
npm run db:init
npm run dev        # hot-reload with tsx
```

## Onboarding a New Team

Adding a new team takes 3 steps:

### Step 1: Create team config YAML

Copy an existing config and customize:

```bash
cp teams/ci-platform.yaml teams/your-team.yaml
```

Edit the file with your team's:
- JIRA project key, statuses, custom fields
- CI providers (GitHub Actions, Harness, etc.)
- Git conventions (base branch, commit format, PR sections)
- Code style and review checklist
- Common issue patterns
- Module definitions with path prefixes
- Repository list (GitHub and/or Harness Code)

### Step 2: Add team mapping

Add your JIRA project → team mapping in `config/team-mapping.yaml`:

```yaml
team_mappings:
  # ... existing mappings ...
  - jira_project: "YOUR_PROJECT"
    team_id: "your-team-id"
```

### Step 3: Run db:init

```bash
npm run db:init
```

This is idempotent — it creates new Team/Module nodes without affecting existing data. Then add the team node and module nodes to the init script at `src/scripts/init-db.ts`, or they'll be created on next run.

That's it. Team members can now register via `ship_register` and start using the system.

## Project Structure

```
ship-server/
├── dashboard/                   # React + MUI frontend (Vite)
│   ├── src/
│   │   ├── App.tsx              # Layout, sidebar, routing
│   │   ├── api.ts               # API client
│   │   ├── components.tsx       # Shared UI components
│   │   ├── hooks.ts             # useFetch hook
│   │   ├── theme.ts             # Colors, category/tier palettes
│   │   └── pages/               # One file per page
│   ├── package.json
│   └── vite.config.ts
├── public/dashboard/            # Built dashboard assets (git-ignored)
├── src/
│   ├── index.ts                 # Entry point
│   ├── mcp/
│   │   ├── server.ts            # MCP streamable HTTP server + dashboard routes
│   │   ├── prompts.ts           # MCP prompt definitions (ship, ship_debug, ship_ingest_jira)
│   │   └── tools.ts             # 8 tool definitions
│   ├── dashboard/
│   │   └── api.ts               # REST API endpoints for dashboard
│   ├── auth/
│   │   ├── jwt.ts               # JWT sign/verify
│   │   └── registration.ts      # User registration + team mapping
│   ├── knowledge/
│   │   ├── graph.ts             # Neo4j driver
│   │   ├── embeddings.ts        # Google Gemini embeddings (3072-dim)
│   │   ├── search.ts            # Hybrid search (vector + graph + fulltext)
│   │   ├── record.ts            # Store new resolutions
│   │   ├── patterns.ts          # Pattern detection
│   │   └── promotion.ts         # Cross-team knowledge promotion
│   ├── ingestion/
│   │   ├── ingest.ts            # Bulk ingestion processor (upsert)
│   │   ├── dedup.ts             # Deduplication
│   │   ├── quality.ts           # Quality tier assignment
│   │   ├── module-mapper.ts     # File path → module mapping
│   │   └── stats.ts             # Ingestion statistics
│   ├── teams/
│   │   └── context.ts           # Team config loading + context enrichment
│   ├── sessions/
│   │   └── blackboard.ts        # Per-session working memory
│   ├── feedback/
│   │   └── processor.ts         # Outcome processing + pattern adjustment
│   └── scripts/
│       └── init-db.ts           # Database initialization
├── teams/                       # Team config YAMLs
│   └── ci-platform.yaml
├── cypher/
│   ├── schema.cypher            # Neo4j schema (indexes, constraints)
│   └── queries/                 # Named Cypher queries
├── config/
│   ├── team-mapping.yaml        # JIRA project → team ID mapping
│   └── promotion-rules.yaml     # Auto-promotion criteria
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## MCP Tools Reference

| Tool | Auth | Purpose |
|------|------|---------|
| `ship_register` | None | One-time registration via Atlassian identity |
| `ship_context` | JWT | Get team config + similar resolutions + hints (start of every run) |
| `ship_search` | JWT | Search knowledge graph (semantic, by_file, by_module, by_error_type, fulltext) |
| `ship_record` | JWT | Record a completed resolution (tries for both ticket + PR details; PR optional in normal flow) |
| `ship_feedback` | JWT | Report resolution outcome (confirmed, partial, reverted) |
| `ship_blackboard` | JWT | Per-session working memory (read/write) |
| `ship_ingest` | JWT | Ingest historical JIRA tickets and PRs (upsert — safe to re-run, mandatory: ticket_id, ticket_summary, ticket_created_at, pr_url, pr_title, pr_repo) |
| `ship_ingest_status` | JWT | Check ingestion statistics and coverage gaps |

## MCP Prompts

| Prompt | Parameters | Purpose |
|--------|------------|---------|
| `ship` | `token` (required), `input` (optional) | Full issue lifecycle: investigate, fix, validate, PR, CI monitor, tracker update, knowledge capture |
| `ship_debug` | `token` (required), `input` (required) | Deep analysis and debugging only — no fix/PR/CI. Uses all available tools for thorough investigation |
| `ship_ingest_jira` | `token` (required), `pr_count` (optional, default "100"), `repos` (optional, comma-separated) | Auto-discover repos, fetch merged PRs, extract JIRA details, ingest into knowledge graph. If `repos` is set, only those repos are processed. |

## Graph Model

```
(:Resolution)-[:HAS_ERROR]->(:Error)
(:Resolution)-[:HAS_ROOT_CAUSE]->(:RootCause)
(:Resolution)-[:HAS_FIX]->(:Fix)
(:Resolution)-[:HAS_TICKET]->(:Ticket)
(:Resolution)-[:HAS_PR]->(:PR)
(:Resolution)-[:CHANGED_FILE]->(:File)
(:Resolution)-[:AFFECTS_MODULE]->(:Module)-[:OWNED_BY]->(:Team)
(:Resolution)-[:SCOPED_TO]->(:Team)
(:Resolution)-[:SIMILAR_TO]->(:Resolution)
(:Resolution)-[:MATCHED_PATTERN]->(:Pattern)
(:Pattern)-[:PATTERN_FILE]->(:File)
(:User)-[:MEMBER_OF]->(:Team)
```

## Dashboard

Ship includes a React + Material UI dashboard for visualizing the knowledge graph — resolutions, patterns, categories, tiers, repos, and timeline.

**Live URL**: `http://<server-host>:3847/dashboard/`

### Dashboard Pages

| Page | Description |
|------|-------------|
| Overview | KPI cards, category/tier breakdowns, recent resolutions |
| Resolutions | Searchable, sortable, paginated list with category/tier filters |
| Resolution Detail | Full PM-friendly detail view (ticket, PR, root cause, fix, files, modules, people, timeline) |
| Insights | Agent interaction lifecycle — how Ship guided users to solutions (investigation steps, decisions, matched references, outcomes) |
| Patterns | Recurring patterns (all categories) with linked tickets/PRs, category filter, occurrence details |
| Repositories | Repos with resolution counts, drill-down to per-repo resolutions |
| Timeline | Stacked bar chart of resolutions over time by category |

### Dashboard API Endpoints

All endpoints are under `/api` and accept an optional `?team=<team_id>` filter.

| Endpoint | Description |
|----------|-------------|
| `GET /api/teams` | List all teams |
| `GET /api/stats` | KPI counts, category/tier breakdowns, recent resolutions |
| `GET /api/resolutions` | Paginated list (`?page=&limit=&category=&tier=&search=`) |
| `GET /api/resolutions/:id` | Full resolution detail |
| `GET /api/insights` | Agent interaction insights — paginated (`?page=&limit=&team=`) |
| `GET /api/patterns` | Patterns with linked resolutions (`?sort=&order=&team=`) |
| `GET /api/repos` | Repositories with resolution counts |
| `GET /api/repos/:repo` | Resolutions for a specific repo |
| `GET /api/timeline` | Daily resolution counts by category (`?days=`) |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | JWT signing key |
| `NEO4J_URI` | No | `bolt://localhost:7687` | Neo4j connection URI |
| `NEO4J_USER` | No | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | No | `shipagent` | Neo4j password |
| `GOOGLE_API_KEY` | **Yes** | — | Google AI API key for embeddings (gemini-embedding-001, 3072-dim). Server will not start without it. Get one free at https://aistudio.google.com/apikey |
| `PORT` | No | `3847` | Server port |
| `HOST` | No | `0.0.0.0` | Server bind address |
| `ALLOWED_EMAIL_DOMAIN` | No | `harness.io` | Email domain for registration |
