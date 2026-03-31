# Ship Agent — Complete Architecture Document

> This document captures the full architecture for evolving the `/ship` skill from a single-user Claude Code prompt into a multi-team, knowledge-driven agent platform. It is written to be consumed by an LLM to restore full context of the design decisions, rationale, and technical details.

---

## Table of Contents

1. [Background & Problem Statement](#1-background--problem-statement)
2. [Current State: /ship as a Skill](#2-current-state-ship-as-a-skill)
3. [Target State: Ship as a Multi-Team Agent Platform](#3-target-state-ship-as-a-multi-team-agent-platform)
4. [Core Design Principle: Server = Brain, Client = Hands](#4-core-design-principle-server--brain-client--hands)
5. [System Architecture](#5-system-architecture)
6. [Authentication: Zero Creds on Server](#6-authentication-zero-creds-on-server)
7. [Knowledge Layer: Neo4j Graph Database](#7-knowledge-layer-neo4j-graph-database)
8. [MCP Tool Surface (8 Tools)](#8-mcp-tool-surface-8-tools)
9. [Data Ingestion System](#9-data-ingestion-system)
10. [Workflow Phases (0-7)](#10-workflow-phases-0-7)
11. [Team Isolation & Cross-Team Knowledge](#11-team-isolation--cross-team-knowledge)
12. [Modern AI Pattern Coverage](#12-modern-ai-pattern-coverage)
13. [Client-Side Skill (Orchestration Prompt)](#13-client-side-skill-orchestration-prompt)
14. [Server Implementation Structure](#14-server-implementation-structure)
15. [Build Sequence](#15-build-sequence)
16. [Key Design Decisions & Rationale](#16-key-design-decisions--rationale)

---

## 1. Background & Problem Statement

### The Organization

Harness has multiple engineering teams (CI Platform, CD Platform, Feature Flags, Chaos Engineering, etc.). Each team follows a similar development workflow:

1. An issue appears (from logs, JIRA tickets, PRs, or direct requests)
2. Investigate and diagnose the root cause
3. Fix the code
4. Validate locally (build, test, lint)
5. Create a PR
6. Monitor CI/CD checks
7. Fix CI failures if any
8. Update the tracker (JIRA)
9. Repeat steps 6-8 until CI passes

### The Problem

Each team has:
- **Different context**: their issues look different (different JIRA projects, different CI pipelines, different repos, different error patterns)
- **Same workflow**: the investigate-fix-validate-ship-monitor cycle is identical
- **No shared learning**: when Team A fixes a bug in shared code, Team B doesn't benefit from that knowledge when they hit the same pattern
- **No memory**: every fix starts from scratch, even for recurring error patterns

### The Goal

Build a **one-shot agent** that:
- Any developer on any team can invoke from any code agent (Claude Code, Cursor, Windsurf, etc.)
- Autonomously handles the full lifecycle: investigate -> fix -> validate -> PR -> CI -> tracker
- Learns from past resolutions and gets better over time
- Keeps team context/data separate but allows controlled cross-team knowledge sharing
- Follows modern AI architecture patterns (RAG, Graph RAG, multi-agent, memory systems)

---

## 2. Current State: /ship as a Skill

### What Exists Today

Location: `/Users/raghav/.claude/skills/ship/`

The current `/ship` is a Claude Code skill — a prompt template (SKILL.md, ~385 lines) that gets loaded into the LLM's context window when invoked.

#### Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Main orchestration prompt (385 lines) — workflow phases, rules, entry points |
| `config.yaml` | Project-specific config (tracker, CI providers, git conventions, build commands) |
| `agents/code-tracer.md` | Sub-agent: traces error messages through codebase |
| `agents/log-analyzer.md` | Sub-agent: fetches and analyzes GCP logs |
| `agents/fix-validator.md` | Sub-agent: runs builds, tests, linting |
| `agents/ci-monitor.md` | Sub-agent: monitors CI/CD pipeline status |
| `agents/harness-log-analyzer.md` | Sub-agent: analyzes Harness CI failures via MCP and GCP |
| `agents/jira-manager.md` | Sub-agent: creates/updates JIRA tickets |
| `agents/issue-researcher.md` | Sub-agent: reads tickets, finds similar issues |
| `scripts/parse-gcp-log-url.sh` | Helper: parses GCP log URLs |

#### What It Does Well

- **Config-driven**: project-specific values cleanly separated from logic
- **Multi-entry point**: handles 6 input types (GCP URL, JIRA ticket, GitHub PR, Harness PR, direct fix, no-args)
- **Parallelism**: launches independent agents simultaneously
- **LSP-first**: prefers structured code navigation over text search
- **Autonomous**: "don't ask, ship" philosophy

#### What's Wrong With It

| Problem | Impact |
|---------|--------|
| It's a 385-line prompt, not a system | Entire prompt loaded every run (~5K tokens consumed before work starts) |
| No memory across runs | Fixes the same class of bug from scratch every time |
| No learning | Can't improve investigation strategies based on outcomes |
| Single-user, single-team | Only works for one person's config |
| No cross-team knowledge | Team A's fixes don't help Team B |
| Agent communication is fire-and-forget | Sub-agents can't share findings or iterate |
| No confidence gating | Proceeds even when root cause is uncertain |
| No feedback loop | Doesn't track if fixes actually resolved the issue |

---

## 3. Target State: Ship as a Multi-Team Agent Platform

### Architecture Summary

Ship becomes a **remote MCP server** (the knowledge brain) paired with a **client-side skill** (the orchestration prompt). All execution happens on the developer's machine using their local MCP servers and credentials.

**The server stores zero external credentials.** It only knows:
- Who users are and which teams they belong to (via one-time Atlassian-verified registration)
- Past resolutions and learned patterns (in a Neo4j knowledge graph)

**The client-side skill** is a lightweight orchestration prompt (~100 lines) that tells the LLM:
- When to call the ship server for knowledge
- When to call other MCP servers for execution
- The workflow phases and decision logic

### Components

| Component | Where It Runs | What It Does |
|-----------|--------------|--------------|
| Ship MCP Server | Remote (shared infra) | Knowledge storage, retrieval, team isolation, cross-team search |
| Ship Skill (SKILL.md) | Client (in LLM context) | Orchestration logic — workflow phases, decision trees |
| Atlassian MCP | Client (dev's machine) | JIRA operations with dev's own creds |
| GitHub MCP | Client (dev's machine) | PR/code operations with dev's own token |
| Harness MCP | Client (dev's machine) | CI/CD operations with dev's own creds |
| Remote Shell MCP | Client (dev's machine) | SSH sessions, live system debugging |
| Local tools | Client (dev's machine) | File editing, builds, tests, git operations |

---

## 4. Core Design Principle: Server = Brain, Client = Hands

```
Developer's Machine (HANDS)              Ship Server (BRAIN)
------------------------------------     ----------------------------------
- All credentials live here              - Zero external credentials
- All code execution happens here        - Never calls Atlassian/GitHub/GCP
- All MCP servers run here               - Only stores knowledge
- LLM orchestrates the workflow          - Only answers questions
- Git push, PR create, CI monitor        - "Here's what I know about this
- Build, test, lint                        error pattern from past fixes"
- SSH into VMs (remote-shell)            - "Here's your team's config"
- JIRA transitions                       - "CD team fixed something similar"
```

### Why This Split?

1. **Security**: No credentials on the server means no credential management, no rotation, no breach risk
2. **Simplicity**: Developers already have all MCP servers configured locally — ship just adds knowledge on top
3. **Client agnostic**: Any MCP-compatible client (Claude Code, Cursor, etc.) can connect — just add a URL
4. **Remote-shell access**: Because MCPs run locally, the LLM can use remote-shell for SSH investigation alongside ship for knowledge

---

## 5. System Architecture

```
+--------------------------------------------------------------+
|  Developer's Machine                                          |
|                                                               |
|  Claude Code / Cursor / Any MCP Client                        |
|  +----------------------------------------------------------+|
|  |            LLM Agent Loop                                 ||
|  |                                                           ||
|  |  Ship Skill (SKILL.md) = orchestration prompt             ||
|  |  "Call ship server for knowledge,                         ||
|  |   call other MCPs for execution"                          ||
|  |                                                           ||
|  |  +----------+ +----------+ +----------+ +--------------+ ||
|  |  |Atlassian | | GitHub   | | Harness  | | Remote Shell | ||
|  |  |MCP       | | MCP      | | MCP      | | MCP          | ||
|  |  |(dev creds)| |(dev creds)| |(dev creds)| | (SSH access) | ||
|  |  +----------+ +----------+ +----------+ +--------------+ ||
|  |  +----------+ +--------------------------------------+   ||
|  |  | Local    | | Ship MCP (remote)                     |   ||
|  |  | tools    | | > knowledge only                      |   ||
|  |  | Read,Edit| | > no creds, no execution              |   ||
|  |  | Bash,Git | +-------------------+------------------+   ||
|  |  +----------+                     |                       ||
|  +-----------------------------------|-----------------------+|
+---------------------------------------|-----------------------+
                                        | HTTPS
                                        v
+---------------------------------------------------------------+
|  Ship Server (remote)                                          |
|                                                                |
|  +----------------------------------------------------------+ |
|  |  Auth Layer                                                | |
|  |  - Validates JWT signatures (only secret: signing key)     | |
|  |  - Maps user -> team(s)                                    | |
|  |  - Scopes all queries to team                              | |
|  +----------------------------------------------------------+ |
|                                                                |
|  +----------------------------------------------------------+ |
|  |  Team Context Store                                        | |
|  |  - Per-team configs (YAML): tracker, CI, git, code style  | |
|  |  - Per-team issue patterns                                 | |
|  +----------------------------------------------------------+ |
|                                                                |
|  +----------------------------------------------------------+ |
|  |  Knowledge Layer (Neo4j)                                   | |
|  |  - Graph: errors, root causes, fixes, files, modules      | |
|  |  - Vector indexes for semantic similarity search           | |
|  |  - Per-team namespacing via Team nodes + relationships     | |
|  |  - Global knowledge (cross-team promoted patterns)         | |
|  +----------------------------------------------------------+ |
|                                                                |
|  +----------------------------------------------------------+ |
|  |  Feedback Processor (cron)                                 | |
|  |  - Check if resolved errors recurred (24h, 72h)           | |
|  |  - Score resolution effectiveness                          | |
|  |  - Promote high-value resolutions to global                | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
```

---

## 6. Authentication: Zero Creds on Server

### Design Constraints

- Server stores NO external service credentials (no Atlassian tokens, GitHub tokens, GCP creds)
- Server needs to identify users and map them to teams
- Must be simple — no complex OAuth flows for daily use
- Atlassian is the identity provider (everyone at Harness is in the Atlassian org)

### One-Time Registration Flow

```
REGISTRATION (once per developer):

1. Developer calls any ship tool for the first time
2. Server detects no valid JWT → returns "not registered"
3. LLM (on dev's machine) calls mcp__atlassian__atlassianUserInfo()
   using the dev's locally-configured Atlassian MCP
4. LLM calls ship_register() with the Atlassian user info:
   {
     atlassian_id: "5f3c...a7b2",
     email: "raghav@harness.io",
     name: "Raghav",
     projects: ["CI", "CD"]
   }
5. Server validates:
   - Email domain is @harness.io (trusted internal domain)
   - atlassian_id format is valid
6. Server maps user to team:
   - projects["CI"] -> team "ci-platform" (from server-side team-mapping config)
7. Server creates minimal user record (id, email, teams — no passwords)
8. Server signs a JWT:
   { sub: user_id, email: "raghav@harness.io", teams: ["ci-platform"], exp: +1 year }
9. Returns JWT to client
10. Dev stores JWT locally (~/.ship/token or in MCP config env var)
```

### Subsequent Calls

```
Every MCP call includes: X-Ship-Token: <JWT>

Server:
1. Verifies JWT signature (stateless — no DB lookup needed)
2. Extracts user_id and teams from JWT claims
3. Scopes all queries to the user's team(s)
```

### What Lives Where

| Item | Location |
|------|----------|
| Atlassian OAuth token | Dev's machine (Atlassian MCP config) |
| GitHub token | Dev's machine (GitHub MCP config) |
| GCP credentials | Dev's machine (gcloud auth) |
| Harness API token | Dev's machine (Harness MCP config) |
| Ship JWT | Dev's machine (~/.ship/token) |
| JWT signing key | Ship server (the ONLY secret it has) |
| User registry | Ship server (email + team mapping, no passwords, no external tokens) |

### Team Mapping Config (Server-Side)

```yaml
# Server config: team-mapping.yaml
team_mappings:
  - jira_project: "CI"
    team_id: "ci-platform"
  - jira_project: "CD"
    team_id: "cd-platform"
  - jira_project: "FF"
    team_id: "feature-flags"
  - jira_project: "CHAOS"
    team_id: "chaos-engineering"
```

### Developer MCP Setup

```json
{
  "mcpServers": {
    "ship": {
      "url": "https://ship.internal.harness.io/mcp",
      "headers": {
        "X-Ship-Token": "${SHIP_TOKEN}"
      }
    }
  }
}
```

---

## 7. Knowledge Layer: Neo4j Graph Database

### Why Neo4j (Not Postgres)

The resolution data is fundamentally graph-shaped:
- Errors connect to root causes
- Root causes connect to fixes
- Fixes connect to files
- Files belong to modules
- Modules are owned by teams
- Patterns match across errors
- Resolutions link across teams

Postgres can model this with joins, but:
- Multi-hop traversals (error -> root cause -> fix -> files -> module -> team) require recursive CTEs
- "What errors tend to appear when module X changes?" is a natural graph query but a painful SQL query
- Cross-team knowledge discovery requires graph-style pattern matching

Neo4j provides all three search modes in one database:
- **Graph traversal** (native Cypher queries)
- **Vector search** (built-in since Neo4j 5.11, for semantic similarity)
- **Full-text search** (built-in, for keyword matching)

### Graph Model — Node Types

```
(:Error {
  id: UUID,
  signature: String,        // "nil pointer dereference in Handler.Execute"
  message: String,           // full error message
  severity: String,          // ERROR, CRITICAL, PANIC
  embedding: vector(1024)    // for semantic similarity search
})

(:RootCause {
  id: UUID,
  description: String,      // "DB query returns nil for soft-deleted pipelines"
  category: String,          // nil_check, timeout, config, race_condition, etc.
  embedding: vector(1024)
})

(:Fix {
  id: UUID,
  approach: String,          // "Added nil check + ErrNotFound sentinel"
  diff_summary: String,      // high-level description of code changes
  embedding: vector(1024)
})

(:File {
  path: String,              // "pipeline/handler.go"
  language: String           // "go"
})

(:Module {
  name: String,              // "pipeline"
  path_prefix: String        // "pipeline/"
})

(:Team {
  id: String,                // "ci-platform"
  name: String,              // "CI Platform"
  config: JSON               // full team config (tracker, CI, git, build, code_style)
})

(:User {
  id: UUID,
  atlassian_id: String,
  email: String,
  name: String
})

(:Resolution {
  id: UUID,
  source: String,             // "agent" (from /ship runs) | "ingested" (from /ship ingest)
  resolution_type: String,    // "code_fix" | "config_change" | "knowledge_gap" | "expected_behavior" | "documentation" | "environment"
  status: String,            // pending | merged | confirmed_resolved | partial | reverted
  input_type: String,        // gcp_log | jira_ticket | pr | direct | no_input
  created_at: DateTime,
  ci_attempts: Int,
  investigation_path: List<String>,  // ordered steps taken
  effective_step: String,     // which investigation step found root cause
  time_to_root_cause_minutes: Int,
  ingestion_confidence: Float, // 1.0 for agent-resolved, 0.5-0.9 for ingested (LLM's confidence in extraction)
  embedding: vector(1024)
})

(:Pattern {
  id: UUID,
  description: String,       // "nil pointer after DB query"
  occurrences: Int,
  success_rate: Float,
  typical_fix: String,
  typical_files: List<String>,
  last_seen: DateTime,
  embedding: vector(1024)
})

(:Ticket {
  id: String,                // "CI-20712"
  provider: String,          // "jira" | "github-issues"
  project: String            // "CI"
})

(:PR {
  url: String,
  number: Int
})

(:Repo {
  name: String,              // "harness/harness-core" or "ci-manager"
  url: String,               // full repo URL
  default_branch?: String,   // "master" | "main"
  language?: String,         // "go" | "typescript" | etc.
  description?: String,
  created_at: DateTime
})
// Repos are GLOBAL — not team-specific. They are created automatically
// when resolutions are recorded or ingested. Multiple teams can work
// on the same repo. Team association is inferred via:
//   PR -> IN_REPO -> Repo, and Fix -> CHANGED -> File -> BELONGS_TO -> Module -> OWNED_BY -> Team
```

### Graph Model — Relationships

```
(Resolution)-[:HAS_ERROR]->(Error)
(Resolution)-[:HAS_ROOT_CAUSE]->(RootCause)
(Resolution)-[:HAS_FIX]->(Fix)
(Resolution)-[:FOR_TICKET]->(Ticket)
(Resolution)-[:HAS_PR]->(PR)
(PR)-[:IN_REPO]->(Repo)              // repos are global, not team-specific
(Resolution)-[:CREATED_BY]->(User)
(Resolution)-[:SCOPED_TO]->(Team)
(Resolution)-[:SIMILAR_TO {confidence: Float}]->(Resolution)

(Fix)-[:CHANGED]->(File)
(File)-[:BELONGS_TO]->(Module)
(Module)-[:OWNED_BY]->(Team)

(Error)-[:MATCHES]->(Pattern)
(Pattern)-[:SCOPED_TO]->(Team)          // team-scoped pattern
// Pattern with no SCOPED_TO = global (cross-team)

(User)-[:MEMBER_OF]->(Team)
(RootCause)-[:CAUSED_BY]->(RootCause)   // causal chains
```

### Neo4j Indexes

```cypher
// Vector indexes for semantic search
CREATE VECTOR INDEX error_embedding FOR (e:Error)
  ON (e.embedding) OPTIONS {indexConfig: {
    `vector.dimensions`: 1024,
    `vector.similarity_function`: 'cosine'
  }};

CREATE VECTOR INDEX resolution_embedding FOR (r:Resolution)
  ON (r.embedding) OPTIONS {indexConfig: {
    `vector.dimensions`: 1024,
    `vector.similarity_function`: 'cosine'
  }};

CREATE VECTOR INDEX pattern_embedding FOR (p:Pattern)
  ON (p.embedding) OPTIONS {indexConfig: {
    `vector.dimensions`: 1024,
    `vector.similarity_function`: 'cosine'
  }};

// Full-text indexes for keyword search
CREATE FULLTEXT INDEX error_fulltext FOR (e:Error)
  ON EACH [e.signature, e.message];

// Uniqueness constraints
CREATE CONSTRAINT unique_resolution FOR (r:Resolution) REQUIRE r.id IS UNIQUE;
CREATE CONSTRAINT unique_user FOR (u:User) REQUIRE u.atlassian_id IS UNIQUE;
CREATE CONSTRAINT unique_team FOR (t:Team) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT unique_pattern FOR (p:Pattern) REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT unique_repo FOR (repo:Repo) REQUIRE repo.name IS UNIQUE;

// Regular indexes
CREATE INDEX file_path_index FOR (f:File) ON (f.path);
CREATE INDEX repo_url_index FOR (repo:Repo) ON (repo.url);
```

### Key Cypher Queries

#### Find similar past resolutions for an error (vector + graph)

```cypher
// Semantic search via vector index
CALL db.index.vector.queryNodes('error_embedding', 5, $error_embedding)
YIELD node AS similar_error, score

// Traverse graph to get full context
MATCH (similar_error)<-[:HAS_ERROR]-(res:Resolution)-[:HAS_FIX]->(fix:Fix)
MATCH (res)-[:SCOPED_TO]->(team:Team {id: $team_id})
WHERE res.status = 'confirmed_resolved'
OPTIONAL MATCH (fix)-[:CHANGED]->(f:File)
OPTIONAL MATCH (res)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
RETURN res, fix, similar_error, rc, collect(f.path) AS files, score
ORDER BY score DESC
```

#### When code in module X changes, what errors tend to appear?

```cypher
MATCH (m:Module {name: $module})<-[:BELONGS_TO]-(f:File)
      <-[:CHANGED]-(fix:Fix)<-[:HAS_FIX]-(res:Resolution)
      -[:HAS_ERROR]->(err:Error)
RETURN err.signature, count(*) AS frequency,
       collect(DISTINCT f.path) AS affected_files
ORDER BY frequency DESC
```

#### Cross-team: similar error in shared code?

```cypher
// Find the error's module
MATCH (err:Error {signature: $sig})<-[:HAS_ERROR]-(res:Resolution)
      -[:HAS_FIX]->(fix:Fix)-[:CHANGED]->(f:File)
      -[:BELONGS_TO]->(m:Module)

// Find other teams' resolutions in same module
MATCH (m)<-[:BELONGS_TO]-(f2:File)<-[:CHANGED]-(fix2:Fix)
      <-[:HAS_FIX]-(res2:Resolution)-[:SCOPED_TO]->(other_team:Team)
WHERE other_team.id <> $team_id
  AND res2.status = 'confirmed_resolved'
RETURN other_team.id, res2, fix2
```

#### Causal chain traversal

```cypher
MATCH path = (err:Error)<-[:HAS_ERROR]-(res:Resolution)
             -[:HAS_ROOT_CAUSE]->(rc:RootCause)
             -[:CAUSED_BY*0..3]->(deeper:RootCause)
RETURN path
```

#### Best investigation method for error type

```cypher
MATCH (err:Error)-[:MATCHES]->(p:Pattern)<-[:MATCHES]-(err2:Error)
      <-[:HAS_ERROR]-(res:Resolution)-[:SCOPED_TO]->(t:Team {id: $team_id})
WHERE p.description CONTAINS $error_type
  AND res.status = 'confirmed_resolved'
RETURN res.effective_step, avg(res.time_to_root_cause_minutes) AS avg_time,
       count(*) AS occurrences
ORDER BY avg_time ASC
```

---

## 8. MCP Tool Surface (8 Tools)

The ship server exposes exactly 8 tools via MCP (streamable HTTP transport).

Tools 1-6: Core workflow. Tools 7-8: Knowledge ingestion.

### Tool 1: ship_register

```
Purpose: One-time user registration. No auth required (this IS the auth flow).

Input: {
  atlassian_id: String,     // from mcp__atlassian__atlassianUserInfo()
  email: String,
  name: String,
  projects: String[]        // JIRA projects the user has access to
}

Output: {
  token: String,            // JWT — dev stores this locally
  user_id: String,
  teams: String[]            // teams the user was mapped to
}

Server logic:
  1. Validate email domain (@harness.io)
  2. Map JIRA projects to teams via team-mapping config
  3. Create user record (id, email, teams — no passwords)
  4. Sign JWT with server's signing key
  5. Return JWT
```

### Tool 2: ship_context

```
Purpose: The MAIN tool. Called at the start of every /ship run.
         Returns team config + similar past resolutions + investigation hints.

Auth: JWT required (X-Ship-Token header)

Input: {
  input?: String,           // "CI-20712" | PR URL | GCP log URL | description | null
  error_text?: String       // optional: extracted error text for better similarity search
}

Output: {
  team_config: {
    tracker: { provider, project, statuses, custom_fields, ... },
    ci: { providers: [...], max_fix_attempts },
    git: { base_branch, branch_format, commit_format, pr_sections },
    build: { auto_detect, commands? },
    code_style: { language, test_approach, review_checklist },
    issue_patterns: [{ pattern, typical_root_cause, typical_fix_area }]
  },
  similar_resolutions: [{
    resolution_type: String,   // "code_fix" | "knowledge_gap" | "expected_behavior" | etc.
    error_signature: String,
    root_cause: String,
    fix_approach: String,
    files_changed: String[],
    confidence: Float,        // vector similarity score
    ticket: String,
    pr_url: String,
    repo?: String,            // repository name (from global Repo nodes)
    source_team?: String      // set if from cross-team/global
  }],
  patterns: [{
    description: String,
    occurrences: Int,
    success_rate: Float,
    typical_fix: String
  }],
  investigation_hints: String[]
  // e.g., "This error pattern was seen 3 times. Root cause was usually
  //  a missing nil check after DB query. Check handler.go and service.go first."
  // e.g., "For timeout errors on this team, remote-shell investigation
  //  resolves 3x faster than log analysis. SSH into the VM first."
}

Server logic:
  1. Extract team_id from JWT
  2. Load team config
  3. If input provided: generate embedding, search team memory (vector + graph)
  4. If low results from team: search global knowledge
  5. Generate investigation_hints from patterns + procedural memory
  6. Return everything
```

### Tool 3: ship_search

```
Purpose: Semantic/graph search over memory. Called mid-investigation
         when the LLM needs more context or hits a dead end.

Auth: JWT required

Input: {
  query: String,            // "context deadline exceeded in delegate task handler"
  strategy?: String,         // "semantic" | "by_file" | "by_module" | "by_error_type" | "fulltext"
  cross_team?: Boolean,      // default false; true searches global + other teams
  file_paths?: String[],     // for by_file strategy
  repo?: String              // filter by repository name (matches global Repo nodes)
}

Output: {
  resolutions: [{
    resolution_type,           // "code_fix" | "knowledge_gap" | etc.
    error_signature, root_cause, fix_approach, files_changed,
    confidence, ticket, pr_url, repo?, source_team?
  }],
  patterns: [{
    description, occurrences, success_rate, typical_fix
  }]
}

Server logic:
  1. Generate embedding for query
  2. Based on strategy:
     - semantic: vector similarity search on Error/Resolution embeddings
     - by_file: graph query "resolutions that changed these files"
     - by_module: graph query "resolutions in this module"
     - by_error_type: pattern matching + graph traversal
  3. If cross_team: also search global knowledge + other teams (with ACL)
  4. Return ranked results
```

### Tool 4: ship_record

```
Purpose: Record a completed resolution. Called after investigating ANY issue —
         whether it was a code bug, knowledge gap, config issue, or expected behavior.
         Server embeds, stores, detects patterns, considers global promotion.

Auth: JWT required

Input: {
  resolution_type: String,   // "code_fix" | "config_change" | "knowledge_gap" |
                              // "expected_behavior" | "documentation" | "environment"
  error_signature: String,   // error pattern or symptom description
  input_type: String,        // "gcp_log" | "jira_ticket" | "pr" | "direct" | "no_input"
  ticket_id?: String,
  pr_url?: String,
  pr_repo?: String,          // repository name or URL (creates/merges Repo node in graph)
  root_cause: String,        // for knowledge gaps: what the user needed to understand
  investigation_path: String[],  // ordered list of steps taken
  effective_step?: String,   // which step found root cause (for procedural memory)
  fix_approach: String,      // for knowledge gaps: the explanation given or doc link
  files_changed: [{ path: String, summary: String }],  // can be empty for non-code resolutions
  diff_summary?: String,
  ci_attempts: Int
}

Output: {
  resolution_id: String
}

Server logic:
  1. Create Resolution node (with resolution_type) + related Error, RootCause, Fix, File, Ticket, PR nodes
  2. If pr_repo provided: create/merge Repo node, link PR -> IN_REPO -> Repo
  3. Connect to Team and User via relationships
  4. Generate embeddings for Error, Resolution
  5. Connect Files to Modules (by path prefix matching)
  6. Search for similar existing Errors -> create SIMILAR_TO edges
  7. Check if error matches existing Pattern -> increment or create
  8. Check global promotion eligibility:
     - Fix touches shared code (commons/, platform/, utils/) AND
     - Pattern has occurred 2+ times across teams AND
     - Success rate >= 0.8
     -> If eligible, promote to global

Resolution type handling:
  - "code_fix": full workflow (standard case)
  - "knowledge_gap": stored with empty files_changed, root_cause explains the gap,
    fix_approach describes the explanation given. Valuable for future similar questions.
  - "expected_behavior": stored so future investigations can short-circuit.
    "This was investigated before — it's by design."
  - "config_change" / "documentation" / "environment": stored with relevant context.
    May or may not have code changes.
```

### Tool 5: ship_feedback

```
Purpose: Record outcome of a resolution. Called manually or by automated checks.

Auth: JWT required

Input: {
  resolution_id: String,
  outcome: String            // "confirmed_resolved" | "partial" | "reverted" | "promote_global"
}

Output: {
  updated: Boolean
}

Server logic:
  1. Update Resolution node status
  2. If "confirmed_resolved": increase pattern success_rate
  3. If "partial" or "reverted": decrease pattern success_rate
  4. If "promote_global": promote to global knowledge (manual override)
  5. If "reverted": flag for investigation
```

### Tool 6: ship_blackboard

```
Purpose: Persistent working memory per session. Survives context window compression.
         Also enables resuming interrupted /ship runs.

Auth: JWT required

Input: {
  session_id: String,        // unique per /ship invocation
  phase?: String,            // "investigate" | "fix" | "validate" | "ship" | "monitor"
  findings?: JSON            // arbitrary structured data to persist
  // If only session_id provided: reads current state
  // If phase + findings provided: writes/updates state
}

Output: {
  session: {
    id: String,
    team_id: String,
    input: String,
    current_phase: String,
    findings: JSON,            // all accumulated findings
    created_at: DateTime,
    updated_at: DateTime
  }
}

Server logic:
  1. If read (no findings): return current session state
  2. If write: merge findings into session state, update phase
  3. Sessions expire after 24h of inactivity
  4. Enables: "I was shipping CI-20712, got interrupted"
     -> LLM calls ship_blackboard(session_id) -> gets full state back
```

### Tool 7: ship_ingest

```
Purpose: Ingest pre-processed historical data (JIRA tickets and/or PRs) into the
         knowledge graph. The LLM on the client fetches raw data from Atlassian/GitHub
         MCPs, extracts structured resolution data, and sends it here.

         Accepts single items or batches. Each record is independently processed.

Auth: JWT required

Input: {
  records: [{
    source_type: String,       // "jira_ticket" | "pr"

    // --- Ticket data (from Atlassian MCP) ---
    ticket_id?: String,        // "CI-20712"
    ticket_summary?: String,   // JIRA summary
    ticket_status?: String,    // "Done", "Closed", etc.
    ticket_resolution?: String, // "Fixed", "Won't Fix", etc.

    // --- PR data (from GitHub/Harness MCP) ---
    pr_url?: String,
    pr_title?: String,
    pr_state?: String,         // "merged" | "closed" | "open"
    pr_diff_summary?: String,  // LLM-generated summary of the diff
    pr_files_changed: [{ path: String, change_type: String, summary: String }],
    pr_repo?: String,          // "harness/harness-core"

    // --- LLM-extracted resolution data ---
    error_signature?: String,   // extracted error pattern (may be null for features)
    root_cause?: String,        // LLM's understanding of the root cause
    fix_approach?: String,      // LLM's summary of how it was fixed
    category: String,           // "bugfix" | "feature" | "refactor" | "config_change"

    // --- Module classification ---
    modules: [{
      name: String,             // "pipeline"
      confidence: Float,        // LLM's confidence this belongs to this module
      reason: String            // "PR changed pipeline/handler.go, pipeline/service.go"
    }],

    // --- Quality signals ---
    extraction_confidence: Float,  // 0.0-1.0: how confident the LLM is in its extraction
    has_clear_error: Boolean,      // true if a clear error pattern was found
    has_clear_fix: Boolean,        // true if a clear fix approach was identified
    cross_module: Boolean          // true if PR spans multiple modules
  }]
}

Output: {
  ingested: Int,               // number successfully ingested
  skipped: Int,                // number skipped (duplicates, low quality)
  errors: Int,                 // number that failed
  details: [{
    ticket_id?: String,
    pr_url?: String,
    status: "ingested" | "skipped" | "error",
    reason?: String,           // why skipped/errored
    resolution_id?: String     // if ingested
  }]
}

Server logic:
  1. For each record:
     a. Dedup check: does this ticket_id or pr_url already exist in the graph?
        -> If yes: skip (or merge if new data is richer)
     b. Quality gate: skip if extraction_confidence < 0.3 AND has_clear_error = false
     c. Create Resolution node (source: "ingested", ingestion_confidence: extraction_confidence)
     d. Create/merge Error, RootCause, Fix, File, Ticket, PR nodes
     e. Map files to Modules using server-side module registry
     f. If LLM-provided modules differ from server mapping: use server mapping
        but log the discrepancy (LLM may have identified a new module)
     g. Connect to Team(s) — determined by:
        - JIRA project key → team (primary)
        - File paths → module → team (may add secondary teams)
     h. Generate embeddings for Error, Resolution
     i. Search for similar existing resolutions → create SIMILAR_TO edges
     j. Check if error matches existing Pattern → increment or create
  2. Return summary
```

### Tool 8: ship_ingest_status

```
Purpose: Check ingestion statistics for a team. How much knowledge has been
         ingested, quality distribution, coverage gaps.

Auth: JWT required

Input: {
  team_id?: String,            // default: caller's team
  since?: String               // ISO date, default: all time
}

Output: {
  total_resolutions: Int,
  by_source: {
    agent: Int,                // from /ship runs
    ingested: Int              // from /ship ingest
  },
  by_category: {
    bugfix: Int,
    feature: Int,
    refactor: Int,
    config_change: Int
  },
  by_quality: {
    high: Int,                 // extraction_confidence >= 0.8
    medium: Int,               // 0.5-0.8
    low: Int                   // < 0.5
  },
  top_modules: [{
    name: String,
    resolution_count: Int
  }],
  coverage_gaps: [{
    module: String,
    reason: String             // "only 2 resolutions — consider ingesting more"
  }],
  recent_ingestions: [{
    ticket_id: String,
    ingested_at: DateTime,
    confidence: Float
  }]
}
```

---

## 9. Data Ingestion System

The ingestion system bootstraps the knowledge graph with historical data. Instead of waiting for the graph to build organically through `/ship` runs, developers can feed it past JIRA tickets and PRs to create an instant knowledge base.

### Core Principle: Client Extracts, Server Stores

The **LLM on the client** does all understanding — it reads tickets, PRs, diffs, comments, and extracts structured resolution data. The **server** only stores, embeds, links, and indexes.

This follows the same "server = brain, client = hands" principle. The server has no Atlassian or GitHub credentials. All data fetching happens client-side using the developer's own MCP servers.

```
Developer: "/ship ingest" (or triggers ship_ingest_jira prompt)
     |
     v
LLM (client-side, guided by prompt)
     |
     |-- ship_context: get team config (repos, JIRA project)
     |
     |-- For each repo in team config:
     |     |-- GitHub/Harness MCP: fetch last 100 merged PRs
     |     |-- Extract JIRA IDs from PR titles (e.g. "feat: [CI-21042]: ...")
     |     |-- Filter: only keep PRs matching team's JIRA project
     |     |-- Atlassian MCP: fetch JIRA details for each ticket
     |
     |-- LLM analyzes each PR+ticket pair:
     |     - What was the error/problem?
     |     - What was the root cause?
     |     - How was it fixed? (from PR diff)
     |     - Which files were changed?
     |     - Which module(s) does this belong to?
     |     - Is this a bugfix, feature, refactor, or config change?
     |     - How confident am I in this extraction?
     |
     v
ship_ingest(records: [...])  --> Ship Server
     |
     v
Server: dedup, quality gate, create graph nodes,
        embed, link to modules/teams/patterns
```

### Ingestion Flow

Ingestion is **PR-driven and fully automatic**. When triggered, the LLM:

1. Gets the team config via `ship_context` to discover repos and the JIRA project key
2. Fetches the last 100 merged PRs from each repo
3. Extracts JIRA IDs from PR titles (pattern: `[A-Z]+-\d+`, e.g. `feat: [CI-21042]: Title`)
4. Filters to only PRs whose JIRA ID matches the team's project (e.g. `CI-*` for ci-platform)
5. Fetches JIRA details for each matched ticket
6. Extracts structured fields and calls `ship_ingest`

```
User: /ship ingest (or triggers ship_ingest_jira prompt)

LLM flow:
1. ship_context(token)
   -> team_config.tracker.jira.default_project = "CI"
   -> team_config.repositories.github = [{owner: "drone-runners", repo: "drone-runner-aws"}, ...]
   -> team_config.repositories.harness_code = {base_url: "...", repos: [...]}

2. For each GitHub repo (e.g. drone-runners/drone-runner-aws):
   mcp__github__list_pull_requests(owner, repo, state: "closed")
   -> Filter merged PRs, take last 100

3. For each merged PR:
   a. Extract JIRA ID from title: "fix:[CI-20712]: Handle nil pointer" -> "CI-20712"
   b. Check prefix matches team project "CI" -> yes, keep
   c. mcp__atlassian__getJiraIssue("CI-20712")
      -> summary, description, status, type, resolution

4. LLM extracts structured data:
   - error_signature: from ticket description/comments
   - root_cause: from PR body ("Root Cause" section) or ticket
   - fix_approach: from PR body ("Solution" section) or diff
   - files_changed: from PR
   - modules: from file paths
   - category: Bug -> "bugfix", Story -> "feature"
   - extraction_confidence: 0.85

5. ship_ingest(records: [batch of up to 20 records])

6. Report: "Scanned 3 repos, 247 PRs. Ingested 89 matching PRs.
   Skipped: 120 (no JIRA ID), 38 (wrong project)."
```

### Module Classification

The LLM and server collaborate on module classification:

#### Step 1: LLM classifies (client-side)

The LLM looks at files_changed and applies judgment:

```
Files changed:
  - pipeline/handler.go
  - pipeline/service.go
  - pipeline/handler_test.go

LLM classification:
  modules: [{
    name: "pipeline",
    confidence: 0.95,
    reason: "All 3 files are in pipeline/"
  }]
```

Multi-module example:

```
Files changed:
  - pipeline/handler.go        -> pipeline module
  - commons/cache/redis.go     -> commons-cache module (shared)
  - delegate/task_executor.go  -> delegate module

LLM classification:
  modules: [
    { name: "pipeline", confidence: 0.7, reason: "Primary change in pipeline/handler.go" },
    { name: "commons-cache", confidence: 0.9, reason: "Fixed shared cache code" },
    { name: "delegate", confidence: 0.5, reason: "Minor caller update" }
  ],
  cross_module: true
```

#### Step 2: Server validates and maps (server-side)

The server has a module registry in each team config:

```yaml
# In team config (server-side)
modules:
  - name: pipeline
    path_prefixes: ["pipeline/", "pkg/pipeline/"]
    primary_team: ci-platform

  - name: delegate
    path_prefixes: ["delegate/", "pkg/delegate/"]
    primary_team: cd-platform

  - name: commons-cache
    path_prefixes: ["commons/cache/"]
    teams: [ci-platform, cd-platform, feature-flags]  # shared module

  - name: connector
    path_prefixes: ["connector/", "pkg/connector/"]
    primary_team: cd-platform
```

Server logic:
1. Map each file in `pr_files_changed` to modules using `path_prefixes`
2. Compare with LLM's module classification
3. **Server mapping wins** for team assignment (it's authoritative)
4. If LLM identified a module the server doesn't know about: log it as a potential new module
5. Create `(Resolution)-[:SCOPED_TO]->(Team)` for each team that owns an affected module
6. Create `(Fix)-[:CHANGED]->(File)-[:BELONGS_TO]->(Module)` for the graph

#### Multi-Module Resolutions

When a resolution spans multiple modules:

```
(Resolution)-[:SCOPED_TO]->(Team: ci-platform)      // primary
(Resolution)-[:SCOPED_TO]->(Team: cd-platform)       // secondary (delegate/)
(Resolution)-[:SCOPED_TO]->(Team: feature-flags)     // tertiary (commons/ shared)

(Fix)-[:CHANGED]->(File: pipeline/handler.go)-[:BELONGS_TO]->(Module: pipeline)
(Fix)-[:CHANGED]->(File: commons/cache/redis.go)-[:BELONGS_TO]->(Module: commons-cache)
(Fix)-[:CHANGED]->(File: delegate/task_executor.go)-[:BELONGS_TO]->(Module: delegate)
```

All three teams can now find this resolution when searching their own memory. The resolution appears in `ship_context` for any team that owns an affected module.

### Quality Tiers for Ingested Data

Not all ingested data is equal. The server assigns quality tiers based on what was available:

```
Tier 1 (High — confidence >= 0.8):
  JIRA ticket + merged PR + clear error message + clear fix
  -> Full resolution: Error, RootCause, Fix, Files, Pattern
  -> Treated almost the same as agent-resolved data

Tier 2 (Medium — confidence 0.5-0.8):
  JIRA ticket + merged PR, but error/fix not clearly extractable
  -> Partial resolution: Files changed known, but error_signature fuzzy
  -> Used for "by_file" and "by_module" searches, not semantic search

Tier 3 (Low — confidence < 0.5):
  JIRA ticket with no PR, or PR with no clear resolution
  -> Minimal resolution: just the ticket/PR metadata
  -> Used for frequency counting and pattern detection, not fix suggestions

Below Tier 3 (confidence < 0.3):
  -> Skipped entirely. Not worth polluting the graph.
```

The `ship_context` and `ship_search` tools weight results by quality:
- Agent-resolved data (source: "agent") gets a 1.0 weight boost
- Tier 1 ingested data gets 0.9
- Tier 2 gets 0.6
- Tier 3 gets 0.3

### Deduplication

The server prevents duplicate entries:

```
Dedup key: ticket_id + pr_url (either can be null)

Cases:
1. Same ticket_id already exists
   -> Skip (unless new record has a PR that the existing one doesn't — merge)

2. Same pr_url already exists
   -> Skip (unless new record has a ticket that the existing one doesn't — merge)

3. Neither exists
   -> Create new resolution

4. Ticket exists as agent-resolved, now being ingested again
   -> Keep the agent-resolved version (higher quality), skip ingestion
```

### Ingestion as Skill Commands

```
/ship ingest                                   # auto-discover repos, fetch last 100 PRs each
/ship ingest status                            # check ingestion stats
/ship ingest status --team cd-platform         # another team's stats
```

### Example: Complete Ingestion Flow

```
User: /ship ingest

== STEP 1: GET TEAM CONFIG ==
LLM -> ship_context(token)
Returns: {
  team_config: {
    tracker: { jira: { default_project: "CI" } },
    repositories: {
      github: [
        { owner: "drone-runners", repo: "drone-runner-aws" },
        { owner: "drone-plugins", repo: "*" }
      ],
      harness_code: {
        base_url: "https://git0.harness.io/...",
        repos: ["PROD/Harness_Commons/harness-core", ...]
      }
    }
  }
}

== STEP 2: FETCH MERGED PRs ==
For drone-runners/drone-runner-aws:
  LLM -> mcp__github__list_pull_requests("drone-runners", "drone-runner-aws", state: "closed")
  -> 67 merged PRs

For drone-plugins/* (wildcard — list repos first, then PRs for each):
  LLM -> mcp__github__search_repositories("org:drone-plugins")
  -> [drone-plugins/drone-s3, drone-plugins/drone-docker, ...]
  -> 143 merged PRs across repos

For each Harness Code repo:
  LLM -> mcp__harness0__harness_list (merged PRs)
  -> 92 merged PRs

Total: ~302 merged PRs across all repos.

== STEP 3: FILTER BY TEAM PROJECT ==
For each PR, extract JIRA ID from title:
  "fix:[CI-20700]: Handle empty steps" -> CI-20700 (matches "CI" ✓)
  "feat: [CD-3010]: Add retry"         -> CD-3010  (doesn't match "CI" ✗, skip)
  "refactor: clean up tests"           -> no JIRA ID (skip)

Result: 89 PRs with matching CI-* JIRA IDs.

== STEP 4: FETCH JIRA + EXTRACT ==
For CI-20700:
  -> mcp__atlassian__getJiraIssue("CI-20700")
     Returns: { type: Bug, summary: "Pipeline NPE with empty steps", status: Done }

  -> LLM extracts:
  {
    source_type: "jira_ticket",
    ticket_id: "CI-20700",
    ticket_summary: "Pipeline execution fails with NPE when stage has no steps",
    ticket_status: "Done",
    pr_url: "https://github.com/harness/harness-core/pull/4498",
    pr_title: "fix:[CI-20700]: Handle empty steps in stage executor",
    pr_state: "merged",
    pr_files_changed: [
      { path: "pipeline/stage_executor.go", change_type: "modified",
        summary: "Added nil/empty check before iterating steps" }
    ],
    error_signature: "nil pointer dereference in StageExecutor.execute",
    root_cause: "StageExecutor.execute() iterates steps without nil/empty check",
    fix_approach: "Added guard clause: if len(stage.Steps) == 0 { return nil }",
    category: "bugfix",
    modules: [{ name: "pipeline", confidence: 0.95, reason: "All files in pipeline/" }],
    extraction_confidence: 0.92,
    has_clear_error: true,
    has_clear_fix: true,
    cross_module: false
  }

... (repeat for all 89 matching PRs, batched in groups of 20)
-> ship_ingest(records: [20 records per batch])

== STEP 5: RESULTS ==
LLM -> "Scanned 3 repo groups, 302 PRs total.
  Ingested 89 matching PRs:
  - 58 high quality (clear error + fix)
  - 22 medium quality (fix clear, error inferred)
  - 9 low quality (sparse data)
  - Skipped: 120 (no JIRA ID), 38 (wrong project), 55 (JIRA fetch errors)

  Knowledge graph now has 89 resolutions covering
  pipeline (32), delegate (18), commons-cache (12), and 6 other modules."
```

### Graph Nodes Created During Ingestion

For a single high-quality ingestion (CI-20700 example above):

```
Created/Merged Nodes:
  (:Resolution {id: "new-uuid", source: "ingested", status: "merged",
                ingestion_confidence: 0.92, category: "bugfix", ...})
  (:Error {signature: "nil pointer dereference in StageExecutor.execute", ...})
  (:RootCause {description: "iterates steps without nil/empty check", category: "nil_check"})
  (:Fix {approach: "Added guard clause for empty steps list", ...})
  (:File {path: "pipeline/stage_executor.go"})      // merged if exists
  (:File {path: "pipeline/stage_executor_test.go"})  // merged if exists
  (:Ticket {id: "CI-20700", provider: "jira", project: "CI"})
  (:PR {url: "github.com/harness/harness-core/pull/4498", number: 4498})

Created Relationships:
  (Resolution)-[:HAS_ERROR]->(Error)
  (Resolution)-[:HAS_ROOT_CAUSE]->(RootCause)
  (Resolution)-[:HAS_FIX]->(Fix)
  (Resolution)-[:FOR_TICKET]->(Ticket)
  (Resolution)-[:HAS_PR]->(PR)
  (Resolution)-[:CREATED_BY]->(User: whoever ran /ship ingest)
  (Resolution)-[:SCOPED_TO]->(Team: ci-platform)
  (Fix)-[:CHANGED]->(File: pipeline/stage_executor.go)
  (Fix)-[:CHANGED]->(File: pipeline/stage_executor_test.go)
  (File: pipeline/stage_executor.go)-[:BELONGS_TO]->(Module: pipeline)

  // If similar error found in graph:
  (Resolution)-[:SIMILAR_TO {confidence: 0.78}]->(Resolution: CI-20712's resolution)

  // If pattern exists:
  (Error)-[:MATCHES]->(Pattern: "nil pointer after DB/collection access")
```

---

## 10. Workflow Phases (0-7)

### Phase 0: Bootstrap

Every invocation starts here. The LLM (guided by the skill prompt) does:

1. Call `ship_context(input)` with whatever the user provided
2. If no JWT configured: call `mcp__atlassian__atlassianUserInfo()`, then `ship_register()`, tell user to save token
3. Receive team config + similar resolutions + investigation hints
4. Create a blackboard session: `ship_blackboard(session_id, phase: "bootstrap")`
5. Decision:
   - If similar resolution found with confidence > 0.85: **fast path** — verify hypothesis matches, apply similar fix, skip deep investigation
   - If no match or low confidence: proceed to Phase 1

### Phase 1: Investigate

**Entry point depends on input type:**

| Input | Actions |
|-------|---------|
| GCP Log URL | Parse URL, fetch logs (broad + narrow in parallel via gcloud), categorize errors, identify panics/NPEs first |
| JIRA Ticket | Read ticket + comments (Atlassian MCP), search similar resolved issues (JQL), extract log URLs |
| GitHub PR | Fetch PR metadata + check status (GitHub MCP), fetch failed run logs, checkout branch |
| Harness Code PR | Fetch PR via Harness MCP, list CI checks, for failures use harness-log-analyzer |
| Direct Fix | Parse request, locate code (LSP first, grep fallback), map impact |
| No Input | git status/diff/log to detect state, route accordingly |

**Remote Shell usage (when needed):**
- Logs show intermittent/unreproducible failures -> check live state
- Connection/timeout errors -> verify network, ports, processes
- Config mismatch suspected -> cat runtime config on VM
- Use `shell()` to SSH, run diagnostics, `//end` to close

**Confidence gating at end of Phase 1:**
- Confidence >= 0.7: proceed to Phase 2
- Confidence 0.4-0.7: generate 2-3 hypotheses, test cheapest evidence first, call `ship_search(cross_team: true)` for more context
- Confidence < 0.4: ask user for guidance

**Write findings to blackboard:** `ship_blackboard(session_id, phase: "investigate", findings: {...})`

### Phase 2: Fix and Validate

1. Check if complex fix (3+ files, multiple subsystems) -> write plan first
2. Implement fix:
   - LSP: findReferences before modifying any symbol
   - Follow team's code_style from ship_context
   - If past resolution exists: adapt its approach
3. Validate locally:
   - Build (auto-detect or team config commands)
   - Test (auto-detect or team config commands)
   - Lint (if configured)
4. If tests fail: diagnose, fix, re-validate (max 3 attempts)
5. If stuck: call `ship_search()` for similar validation failures, use remote-shell to verify assumptions

### Phase 3: Branch, Commit, PR

1. Ensure ticket exists (auto-create via Atlassian MCP if needed, or skip if tracker=none)
2. Branch: name per team config (e.g., `CI-20712`)
3. Rebase on base_branch, handle conflicts
4. Commit: format per team config (e.g., `fix:[CI-20712]: description`)
5. Push + create PR:
   - GitHub repos: `gh pr create` or GitHub MCP
   - Harness repos: Harness MCP `harness_create(resource_type: "pull_request", ...)`
6. PR description includes: Problem, Root Cause, Solution, Testing, Related Issues

### Phase 3b: Update PR Description

After any additional push (CI fix, review feedback), update PR description to reflect full scope.

### Phase 4: CI Monitor (mandatory after every push)

1. Detect CI provider (from git remote URL or check detailsUrl matching team config)
2. Monitor checks:
   - GitHub Actions: `gh pr checks --watch`
   - Harness: `harness_list(resource_type: "pr_check", ...)`, poll until complete
3. If ALL PASS: proceed to Phase 5
4. If FAILURE:
   - Diagnose each failure (fetch logs, analyze)
   - If stuck: `ship_search("messageCheck missing severity field", cross_team: true)`
   - Fix, re-validate locally, push, update PR description, re-monitor
   - Max `max_fix_attempts` from team config (default 3)

### Phase 5: Tracker Update

Skip if tracker provider is "none".

| Event | JIRA Action | GitHub Issues Action |
|-------|-------------|---------------------|
| Starting work | Transition to "In Progress" | Add "in progress" label |
| PR created + CI green | Transition to "In Review", add PR link comment | Link PR to issue |
| CI failed | Add failure comment | Add failure comment |

### Phase 6: Record Resolution

Call `ship_record()` with full resolution data:
- error_signature, root_cause, investigation_path, effective_step
- fix_approach, files_changed, diff_summary
- ticket_id, pr_url, ci_attempts

Report to user: "Resolved CI-20712. PR #4521 created, CI passing, ticket moved to In Review."

### Phase 7: Feedback Loop (async, server-side cron)

Runs on the ship server, not during user interaction:

Every 24h, for each resolution from the last 7 days:
1. Check if PR was merged (via stored PR URL — server makes no API calls, feedback comes from future `ship_feedback()` calls or manual input)
2. Alternatively: next time any user on the team invokes `/ship`, the skill can check if past resolutions' PRs were merged and call `ship_feedback()` automatically

Pattern promotion rules (auto-promote when ALL true):
- Resolution status = confirmed_resolved
- Fix touches shared code (commons/, platform/, utils/, shared/)
- Pattern has occurred 2+ times across any teams
- Success rate >= 0.8

Manual promotion: any team lead can call `ship_feedback(resolution_id, "promote_global")`

---

## 11. Team Isolation & Cross-Team Knowledge

### Isolation Model

All data is connected to Team nodes via relationships. Every query includes a team scope:

```cypher
// Every query starts with team scoping
MATCH (res:Resolution)-[:SCOPED_TO]->(team:Team {id: $team_id})
```

Teams cannot see each other's resolutions unless:
1. The resolution was promoted to global knowledge (touches shared code + confirmed effective)
2. The querying user explicitly requests `cross_team: true` in `ship_search()`

### Cross-Team Retrieval Strategy

When a new issue comes in, `ship_context` searches in this order:

```
1. Own team's memory (always, highest relevance)
   |
   v  no good match?
2. Global knowledge (cross-team patterns from shared code)
   |
   v  still no match?
3. Full investigation from scratch (current /ship behavior)
```

When `ship_search(cross_team: true)` is explicitly called:

```
1. Own team's memory
2. Global knowledge
3. Other teams' memory (federated search — all teams, ranked by relevance)
```

### Promotion Flow

```
Team A fixes a bug in commons/cache/redis.go
  -> ship_record() stores in Team A's memory
  -> Server detects: fix touches commons/ (shared code)
  -> Server checks: has this pattern been seen before?
     -> Yes, Team B had a similar fix 2 months ago
  -> Resolution marked as promotion candidate
  -> After confirmation (merged + no recurrence after 72h):
     -> Promoted to global knowledge
     -> Now available to ALL teams via ship_context
```

### Example: Cross-Team Knowledge in Action

```
CI Team dev hits an error in commons/cache/redis.go
  |
  v
ship_context(input: "CI-21000")
  |
  v
Server searches ci-platform memory: no match
Server searches global knowledge: MATCH!
  CD team fixed similar redis error (resolution from CD-8923,
  promoted because it touched commons/ and was confirmed resolved)
  |
  v
Returns to LLM:
  similar_resolutions: [{
    source_team: "cd-platform",
    error: "redis connection pool exhaustion under load",
    fix: "added connection recycling with max idle timeout",
    files: ["commons/cache/pool.go"],
    confidence: 0.81
  }]
  investigation_hints: [
    "CD team fixed a similar redis issue. Race condition on pool
     exhaustion. Check commons/cache/pool.go — look for the
     connection lifecycle management."
  ]
```

---

## 12. Modern AI Pattern Coverage

### RAG (Retrieval-Augmented Generation)

| Aspect | Status | Implementation |
|--------|--------|----------------|
| Semantic search over past resolutions | Covered | Neo4j vector index on Error, Resolution, Pattern nodes |
| Keyword search fallback | Covered | Neo4j full-text index on error signatures |
| Hybrid retrieval (vector + keyword + graph) | Covered | `ship_context` combines all three |
| Retrieval before generation | Covered | Phase 0 calls `ship_context` before any investigation |
| Mid-task retrieval | Covered | `ship_search` callable anytime during investigation |

### Graph RAG

| Aspect | Status | Implementation |
|--------|--------|----------------|
| Knowledge graph of errors/fixes/files/modules | Covered | Neo4j graph model with typed nodes and relationships |
| Multi-hop reasoning | Covered | Cypher traversals: error -> root cause -> fix -> files -> module -> team |
| Causal chains | Covered | `(RootCause)-[:CAUSED_BY]->(RootCause)` edges, variable-depth traversal |
| Cross-entity reasoning | Covered | "When module X changes, what errors appear?" via graph query |
| Graph-informed retrieval | Covered | Vector search finds similar errors, graph traversal enriches with full context |

How Graph RAG works in practice:
```
Traditional RAG:
  "Find similar errors" -> vector search -> flat list of results

Graph RAG in ship:
  "Find similar errors" -> vector search -> top errors
    -> traverse graph: what root causes did these have?
      -> what files were involved?
        -> what module are those files in?
          -> who else has fixed things in that module?
            -> what patterns exist for that module?

  Result: not just "here's a similar error" but
  "here's the error, its root cause chain, the module it's in,
   3 past fixes in that module, and the team that knows it best"
```

### Multi-Agent Architecture

| Aspect | Status | Implementation |
|--------|--------|----------------|
| Specialized agents for different tasks | Covered | Each MCP server is a domain specialist (ship=knowledge, atlassian=tracker, github=code, remote-shell=live debug) |
| Parallel agent dispatch | Covered | LLM calls multiple MCP tools in parallel |
| Agent-as-tool pattern | Covered | Ship server = knowledge agent, others = execution agents |
| Orchestrator pattern | Covered | LLM + ship SKILL.md = orchestrator |
| Shared state (blackboard) | Covered | `ship_blackboard` tool — persistent working memory per session |

### Memory Systems

| Memory Type | Status | Implementation |
|-------------|--------|----------------|
| Working memory (current session) | Covered | `ship_blackboard` — per-session state, survives context compression, enables resume |
| Episodic memory (past resolutions) | Covered | Resolution nodes in Neo4j — full history of what was fixed and how |
| Semantic memory (learned knowledge) | Covered | Pattern nodes + module-error correlations in the graph |
| Procedural memory (how to investigate) | Covered | `effective_step` + `time_to_root_cause_minutes` tracking on Resolutions — learns which investigation methods work best for which error types |

### Confidence & Self-Evaluation

| Aspect | Status | Implementation |
|--------|--------|----------------|
| Confidence scoring on retrieval | Covered | Vector similarity scores from Neo4j |
| Confidence gating between phases | Covered | Phase 1->2 gate: >=0.7 proceed, 0.4-0.7 multi-hypothesis, <0.4 ask user |
| Multi-hypothesis reasoning | Covered | Medium confidence triggers 2-3 hypotheses, tested by cheapest evidence first |

### Feedback Loops

| Aspect | Status | Implementation |
|--------|--------|----------------|
| Post-resolution outcome tracking | Covered | `ship_feedback` tool + server-side processing |
| Resolution effectiveness scoring | Covered | Status field on Resolution nodes (confirmed_resolved, partial, reverted) |
| Pattern confidence adjustment | Covered | Pattern success_rate updated on each feedback event |
| Cross-team knowledge promotion | Covered | Auto-promotion rules for confirmed resolutions touching shared code |
| Investigation method learning | Covered | effective_step tracking feeds into investigation_hints |

### Adaptive Retrieval

| Aspect | Status | Implementation |
|--------|--------|----------------|
| Strategy varies by input type | Covered | ship_search `strategy` parameter: semantic, by_file, by_module, by_error_type |
| Corrective RAG (reformulate on low results) | Covered | Low results -> try different strategy -> cross-team fallback |
| Retrieval fallback chain | Covered | Team memory -> global knowledge -> cross-team search -> full investigation |

### Knowledge Bootstrapping & Data Ingestion

| Aspect | Status | Implementation |
|--------|--------|----------------|
| Historical data ingestion | Covered | `ship_ingest` tool — JIRA tickets + PRs processed by client LLM, stored by server |
| Bulk ingestion | Covered | Parallel sub-agents process batches of 5-10 tickets/PRs simultaneously |
| Quality-gated storage | Covered | 3-tier quality system: high (>=0.8), medium (0.5-0.8), low (<0.5), skip (<0.3) |
| Deduplication | Covered | Dedup by ticket_id + pr_url, merge when new data is richer |
| Module auto-classification | Covered | LLM classifies from file paths (client), server validates against module registry (authoritative) |
| Multi-module resolution tracking | Covered | Cross-module PRs create SCOPED_TO edges to all affected teams |
| Ingested vs agent-resolved distinction | Covered | `source` field on Resolution + `ingestion_confidence` weighting in search results |
| Coverage gap analysis | Covered | `ship_ingest_status` identifies modules with sparse data |

---

## 13. Client-Side Skill (Orchestration Prompt)

The SKILL.md that lives on each developer's machine becomes much lighter (~100 lines). It no longer contains team configs, JIRA field mappings, or CI provider details — those come from the server via `ship_context`.

### What the Skill Contains

- Workflow phase descriptions (what to do in each phase)
- Decision logic (when to proceed, when to search more, when to ask user)
- Tool routing (when to call ship server vs. other MCPs)
- Remote-shell usage guidelines

### What the Skill Does NOT Contain

- Team-specific configuration (comes from `ship_context`)
- JIRA field mappings (comes from `ship_context`)
- CI provider details (comes from `ship_context`)
- Any hardcoded project-specific values

### Conceptual Structure

```
Phase 0: Bootstrap
  -> Call ship_context(input) -> get team config + memory
  -> If high-confidence match: fast path
  -> If similar resolution is knowledge_gap/expected_behavior: short-circuit investigation

Phase 1: Investigate (using team config from Phase 0)
  -> Use atlassian/github/harness/remote-shell MCPs
  -> Confidence gating: >=0.7 proceed, 0.4-0.7 multi-hypothesis, <0.4 ask

Phase 2: Fix and Validate
  -> Edit code locally, build, test, lint
  -> If stuck: ship_search() for similar failures
  -> If not a code issue: skip to Phase 6 with appropriate resolution_type

Phase 3: Branch, Commit, PR
  -> Git operations, PR creation (format from team config)
  -> Skip if resolution_type is knowledge_gap/expected_behavior (no code change)

Phase 4: CI Monitor
  -> Monitor checks (method from team config)
  -> If stuck on CI failure: ship_search(cross_team: true)

Phase 5: Tracker Update
  -> Use atlassian/github MCP (settings from team config)

Phase 6: Record Resolution
  -> Call ship_record() with full data including resolution_type
  -> ALWAYS record, even for non-code resolutions

Remote Shell: Use when logs are insufficient, need live state,
  intermittent failures, config verification

Ingestion Mode (triggered by "/ship ingest"):
  -> ship_context() to get team repos and JIRA project key
  -> For each repo: fetch last 100 merged PRs
  -> Extract JIRA IDs from PR titles, filter by team project
  -> Fetch JIRA details for matched tickets
  -> LLM extracts: error, root cause, fix, files, modules, confidence
  -> Call ship_ingest() with batches of up to 20 records
  -> Report results + call ship_ingest_status()
```

### Multi-Agent Adapter Support

The MCP server works with any MCP-compatible agent. The skill is the Claude Code-specific "driver."

| Agent | Orchestration Format | Location |
|-------|---------------------|----------|
| **Claude Code** | Skill (SKILL.md + sub-agents) | `ship-skill/claude-code/` |
| **Cursor** | Rules (.mdc) | `ship-skill/cursor/ship.mdc` |
| **Windsurf** | Rules (.md) | `.windsurfrules` (generate from ship.mdc) |
| **Cline** | Custom Instructions | `.clinerules` (generate from ship.mdc) |
| **Raw MCP** | None needed | Tools are self-describing — agents call them directly |

Without any orchestration file, developers can still call ship tools directly. They lose the automated phased workflow but get full knowledge graph access.

---

## 14. Server Implementation Structure

```
ship-server/                       # Codebase: /Users/raghav/ship-server/
|-- src/
|   |-- index.ts                   # Entry point — starts HTTP server, graceful shutdown
|   |-- mcp/
|   |   |-- server.ts              # MCP streamable HTTP server (express + StreamableHTTPServerTransport)
|   |   +-- tools.ts               # 8 tool definitions with zod schemas
|   |-- auth/
|   |   |-- jwt.ts                 # Sign/verify JWTs (only secret: signing key)
|   |   +-- registration.ts        # Validate email domain, map JIRA projects to teams
|   |-- knowledge/
|   |   |-- graph.ts               # Neo4j driver singleton + runQuery/runWrite helpers
|   |   |-- embeddings.ts          # Embedding generation (Voyage AI, graceful fallback to placeholder vectors on missing/invalid key)
|   |   |-- search.ts              # Hybrid search: vector, by_file, by_module, by_error_type, fulltext, cross-team
|   |   |-- record.ts              # Store new resolutions with resolution_type + Repo nodes
|   |   |-- patterns.ts            # Pattern detection, create/update, confidence adjustment
|   |   +-- promotion.ts           # Cross-team knowledge promotion logic + rules
|   |-- ingestion/
|   |   |-- ingest.ts              # Process ingestion records: dedup, quality gate, create nodes
|   |   |-- dedup.ts               # Deduplication logic (ticket_id + pr_url matching)
|   |   |-- quality.ts             # Quality tier assignment (confidence thresholds)
|   |   |-- module-mapper.ts       # Map file paths to modules using team config registry
|   |   +-- stats.ts               # Ingestion statistics and coverage gap analysis
|   |-- teams/
|   |   +-- context.ts             # Load team config YAML, enrich with memory/hints
|   |-- sessions/
|   |   +-- blackboard.ts          # Per-session working memory CRUD (Neo4j-backed)
|   |-- feedback/
|   |   +-- processor.ts           # Outcome processing, pattern adjustment, promotion checks
|   +-- scripts/
|       +-- init-db.ts             # Database initialization (schema + seed teams/modules)
|-- teams/                         # Team configs (add new YAML to onboard a team)
|   +-- ci-platform.yaml           # CI Platform — pilot team
|-- cypher/
|   |-- schema.cypher              # Indexes, constraints, vector indexes
|   +-- queries/
|       |-- search-similar.cypher
|       |-- cross-team.cypher
|       |-- module-errors.cypher
|       |-- causal-chain.cypher
|       |-- investigation-effectiveness.cypher
|       +-- ingestion-stats.cypher
|-- config/
|   |-- team-mapping.yaml          # JIRA project -> team_id mapping
|   +-- promotion-rules.yaml       # Auto-promotion criteria
|-- docker-compose.yml             # Neo4j + ship-server
|-- Dockerfile
|-- package.json
+-- tsconfig.json

ship-skill/                        # Codebase: /Users/raghav/ship-skill/
|-- claude-code/
|   |-- SKILL.md                   # Main orchestration prompt for Claude Code
|   +-- agents/
|       |-- code-tracer.md         # Trace errors through codebase (LSP + Grep)
|       |-- log-analyzer.md        # Fetch and analyze GCP/cloud logs
|       |-- fix-validator.md       # Run builds, tests, linting
|       |-- ci-monitor.md          # Monitor CI/CD checks (GitHub Actions + Harness)
|       |-- harness-log-analyzer.md  # Analyze Harness CI failures from GCP storage
|       |-- jira-manager.md        # JIRA ticket lifecycle
|       +-- issue-researcher.md    # Research issues + find similar
|-- cursor/
|   +-- ship.mdc                   # Cursor rules adapter
|-- examples/
|   +-- mcp-config.json            # Example MCP server configuration
+-- README.md
```

### What the Server NEVER Does

| Action | Who Does It | Via What |
|--------|------------|----------|
| Read JIRA tickets | Developer's machine | Atlassian MCP (dev's creds) |
| Create PRs | Developer's machine | GitHub MCP (dev's token) |
| Push code | Developer's machine | git (dev's SSH key) |
| Run builds/tests | Developer's machine | Local bash |
| Fetch GCP logs | Developer's machine | gcloud (dev's auth) |
| Monitor CI | Developer's machine | gh CLI or Harness MCP |
| SSH into VMs | Developer's machine | Remote Shell MCP |
| Call ANY external API | NOBODY on the server | — |

---

## 15. Build Sequence

| Phase | What | Dependencies |
|-------|------|-------------|
| **1** | Ship MCP server with `ship_register` + `ship_context` (static team configs, no memory yet) | Neo4j instance, JWT signing setup |
| **2** | Add `ship_record` + episodic memory: store resolutions in Neo4j, search on new issues | Embedding API (Claude/Voyage) |
| **3** | Add `ship_ingest` + `ship_ingest_status`: bulk knowledge bootstrapping from historical JIRA tickets and PRs, with dedup, quality gating, and module classification | Phase 2 (shares embedding + graph node creation logic) |
| **4** | Add `ship_search` with multiple strategies: semantic, by_file, by_module | Phase 2 |
| **5** | Add `ship_blackboard` for session persistence | Simple key-value storage (can use Neo4j or Redis) |
| **6** | Add cross-team knowledge: global store + federated search + promotion rules | Phase 2 + multiple teams onboarded |
| **7** | Add `ship_feedback` + feedback processor: outcome tracking, pattern confidence | Phase 2 |
| **8** | Add procedural memory: investigation effectiveness tracking + investigation_hints | Phase 7 + enough resolution data |
| **9** | Rewrite client-side SKILL.md to be lightweight orchestration prompt using server tools | Phase 1 (can start here, iterate) |

Phase 1 is the unlock. **Phase 3 (ingestion) is the accelerator** — it lets teams bootstrap a useful knowledge graph in hours instead of waiting months for organic accumulation. Each subsequent phase adds a layer of intelligence. Teams can start using the system from Phase 1 (just team config + skill) and progressively benefit as memory and learning layers come online.

### Recommended Ingestion Bootstrapping Plan

After Phase 3 is deployed, each team should run a one-time ingestion:

```
Step 1: Run ingestion (auto-discovers repos, fetches last 100 merged PRs each)
  /ship ingest

Step 2: Check coverage
  /ship ingest status
  -> Identify modules with sparse data

Step 3: Ongoing organic growth
  Every /ship run auto-records (Phase 6: Record Resolution)
  Re-run /ship ingest periodically to pick up new PRs (dedup prevents duplicates)
```

---

## 16. Key Design Decisions & Rationale

### Decision 1: Remote MCP Server (not local)

**Chosen**: Remote MCP server (streamable HTTP)
**Rejected**: Local MCP server (npm install)

**Why**: Ease of developer setup. Adding a URL to MCP config is simpler than installing a package. No version management across teams. Knowledge is naturally centralized.

### Decision 2: Server stores zero external credentials

**Chosen**: All creds stay on dev's machine
**Rejected**: Server stores Atlassian/GitHub tokens for API access

**Why**: Security (no credential management), simplicity (no token rotation), and the server doesn't need to call external services — it's a pure knowledge store.

### Decision 3: Neo4j over PostgreSQL

**Chosen**: Neo4j with built-in vector search
**Rejected**: PostgreSQL + pgvector

**Why**: Resolution data is fundamentally graph-shaped. Multi-hop queries (error -> root cause -> fix -> files -> module -> team) are natural in Cypher but painful in SQL. Neo4j 5.11+ has built-in vector indexes, eliminating the need for a separate vector DB.

### Decision 4: LLM as orchestrator (not server-side orchestration)

**Chosen**: LLM agent loop on client drives the workflow, server provides knowledge
**Rejected**: Server-side orchestration engine that calls back to client

**Why**: The LLM has access to all local MCP servers (remote-shell, atlassian, github, etc.). Server can't call local tools. Keeping orchestration in the LLM is the natural MCP pattern.

### Decision 5: JWT-based auth with Atlassian identity verification

**Chosen**: One-time registration via client-side Atlassian info, server issues JWT
**Rejected**: Full OAuth flow, API keys, or stored Atlassian tokens

**Why**: Simple (one-time setup), secure enough for internal tool (email domain validation), and the server never stores external tokens. JWT is stateless — server verifies signature without DB lookup.

### Decision 6: Blackboard as a tool (not implicit)

**Chosen**: Explicit `ship_blackboard` tool for session state
**Rejected**: Relying on LLM context window as working memory

**Why**: Context windows compress. Long /ship runs may lose phase findings. Explicit blackboard survives compression and enables resuming interrupted runs.

### Decision 7: Client-side LLM extraction for ingestion (not server-side parsing)

**Chosen**: LLM on the client reads tickets/PRs and extracts structured data, sends pre-processed records to server
**Rejected**: Server fetches and parses tickets/PRs directly

**Why**: The server has no external credentials (Decision 2). Beyond that, LLM extraction is fundamentally better than rule-based parsing — it understands that "NPE when stage has no steps" is a nil-check bug even when no explicit error message exists. The quality tiers and confidence scores let the server weight results appropriately.

### Decision 8: Quality tiers for ingested data

**Chosen**: 3-tier quality system with weighted search results
**Rejected**: Treat all data equally, or reject anything below a threshold

**Why**: Even low-confidence ingested data has value for frequency counting and pattern detection ("module X has a lot of churn"). But it shouldn't rank equally with high-confidence agent-resolved data in fix suggestions. Tiered weighting gives the best of both worlds.

### Decision 9: Repos are global graph entities (not team-specific)

**Chosen**: Repos as shared `(:Repo)` nodes, created automatically during `ship_record` and `ship_ingest`
**Rejected**: Repos defined per-team in config YAML

**Why**: Multiple teams work on the same repositories (e.g., harness-core is used by CI, CD, and other teams). Making repos team-specific would duplicate data and miss cross-team repo relationships. Repos get populated organically — when a PR is recorded, a `(PR)-[:IN_REPO]->(Repo)` edge is created. Teams connect to repos implicitly through their resolutions, not through config.

### Decision 10: Resolution types beyond code fixes

**Chosen**: `resolution_type` field with 6 values: code_fix, config_change, knowledge_gap, expected_behavior, documentation, environment
**Rejected**: Treating every resolution as a code fix

**Why**: Not every issue investigation results in a code change. Knowledge gaps ("this is expected behavior"), config issues, and documentation gaps are equally valuable to record. When the next developer hits the same confusion, `ship_context` returns "This was investigated before — it's by design" instead of triggering a full code investigation. The `resolution_type` lets search results differentiate between "here's a similar code fix" and "someone already investigated this — it's not a bug."

### Decision 11: Multi-agent adapter support (Claude Code + Cursor + others)

**Chosen**: One MCP server (universal) + per-agent orchestration "drivers" (SKILL.md for Claude Code, .mdc for Cursor, etc.)
**Rejected**: Agent-specific server endpoints

**Why**: The MCP server is the product — any MCP-compatible agent can connect. The orchestration prompt (skill/rules) is just a "driver" that tells the LLM the phased workflow. Claude Code gets the richest driver (SKILL.md with sub-agents). Cursor gets a rules adapter (.mdc). Even without any driver, developers can call ship tools directly.

### Decision 12: Name stays as "ship"

**Chosen**: `/ship`
**Considered**: `/resolve`, `/pilot`, `/operator`

**Why**: User preference. Short, memorable, action-oriented. The name implies the full lifecycle despite literally meaning "deliver" — it's become the brand for the workflow.

---

## Appendix A: Team Config Example

```yaml
# teams/ci-platform.yaml
team:
  id: ci-platform
  name: "CI Platform"

  tracker:
    provider: jira
    jira:
      cloud_id: "harness.atlassian.net"
      default_project: "CI"
      default_issue_type: "Story"
      statuses:
        start_work: "In Progress"
        review: "In Review"
      custom_fields:
        severity:
          id: "customfield_12847"
          default_value_id: "17014"
        found_in:
          id: "customfield_10632"
        ff_added:
          id: "customfield_10785"
          values:
            "yes": "10910"
            "no": "10911"
        bug_resolution:
          id: "customfield_10687"
        release_notes:
          id: "customfield_10719"
        resolved_as:
          id: "customfield_10709"
          values:
            real_bug: "10383"
            not_a_bug: "10387"

  ci:
    max_fix_attempts: 3
    providers:
      - name: github-actions
        detect_by: "github.com"
        pr_tool: gh
      - name: harness0
        detect_by: "harness0.harness.io"
        mcp_prefix: "mcp__harness0__"
        default_org_id: ""
        default_project_id: ""
        gcp_bucket: "gs://harness-zero-harness0-1391-log-service/"
        log_path_format: "{accountId}/accountId:{accountId}/orgId:{orgId}/..."

  git:
    base_branch: master
    branch_format: "{ticket_id}"
    commit_format: "{type}:[{ticket_id}]: {description}"
    pr_sections:
      - Problem
      - Root Cause
      - Solution
      - Changes Made
      - Testing
      - Related Issues/Logs

  build:
    auto_detect: true

  code_style:
    language: Go
    test_approach: "table-driven tests with testify"
    review_checklist:
      - "nil checks after DB/API calls"
      - "error wrapping with context"
      - "metric labels match conventions"

  issue_patterns:
    - pattern: "runtime error: invalid memory address"
      typical_root_cause: "nil check missing after DB query"
      typical_fix_area: ["pipeline/", "handler/"]
    - pattern: "context deadline exceeded"
      typical_root_cause: "timeout too low or downstream service slow"
      typical_fix_area: ["client/", "config/"]

  # Module registry — used by ingestion system for file -> module mapping
  # and by ship_context for module-scoped retrieval
  modules:
    - name: pipeline
      path_prefixes: ["pipeline/", "pkg/pipeline/"]
    - name: stage-executor
      path_prefixes: ["pipeline/stage/", "pkg/stage/"]
    - name: trigger
      path_prefixes: ["trigger/", "pkg/trigger/"]
    - name: commons-cache        # shared module (also in cd-platform config)
      path_prefixes: ["commons/cache/"]
      shared: true               # signals this module appears in multiple team configs
```

## Appendix B: Complete Flow Example

```
User types: /ship CI-20712

== PHASE 0: BOOTSTRAP ==
LLM -> ship_context(input: "CI-20712")
Server -> returns: {
  team_config: { ...ci-platform config... },
  similar_resolutions: [{
    error: "nil pointer in Handler.Execute",
    fix: "nil check after FindByID",
    confidence: 0.72,
    ticket: "CI-19234"
  }],
  investigation_hints: ["Check handler.go first"]
}

LLM -> ship_blackboard(session_id: "s1", phase: "bootstrap",
         findings: { input: "CI-20712", similar_match: true })

== PHASE 1: INVESTIGATE ==
LLM -> mcp__atlassian__getJiraIssue("CI-20712")         [Atlassian MCP, dev creds]
LLM -> mcp__atlassian__searchJiraIssuesUsingJql(...)     [Atlassian MCP, dev creds]
LLM -> mcp__github__search_code("Handler Execute")       [GitHub MCP, dev token]
LLM -> Read pipeline/handler.go                           [Local tool]
LLM -> LSP goToDefinition, findReferences                 [Local tool]

Confidence: 0.9 (matches similar resolution + code confirms)

LLM -> ship_blackboard(session_id: "s1", phase: "investigate",
         findings: { root_cause: "...", confidence: 0.9 })

== PHASE 2: FIX AND VALIDATE ==
LLM -> Edit pipeline/handler.go                           [Local tool]
LLM -> Edit pipeline/service.go                           [Local tool]
LLM -> Bash: go build ./...                               [Local tool]
LLM -> Bash: go test ./pipeline/... -v                    [Local tool]
All pass.

== PHASE 3: BRANCH, COMMIT, PR ==
LLM -> Bash: git checkout -b CI-20712                     [Local tool]
LLM -> Bash: git add -A && git commit -m "fix:[CI-20712]: ..."  [Local tool]
LLM -> Bash: git push origin CI-20712                     [Local tool]
LLM -> mcp__github__create_pull_request(...)              [GitHub MCP, dev token]
Returns: PR #4521

== PHASE 4: CI MONITOR ==
LLM -> Bash: gh pr checks 4521 --watch                   [Local tool]
All checks pass.

== PHASE 5: TRACKER UPDATE ==
LLM -> mcp__atlassian__transitionJiraIssue("CI-20712", "In Review")  [Atlassian MCP]
LLM -> mcp__atlassian__addCommentToJiraIssue("CI-20712", "PR #4521, CI green")

== PHASE 6: RECORD ==
LLM -> ship_record({
  error_signature: "nil pointer in Handler.Execute",
  input_type: "jira_ticket",
  ticket_id: "CI-20712",
  pr_url: "github.com/harness/core/pull/4521",
  root_cause: "FindByID returns nil for soft-deleted pipelines",
  investigation_path: ["read_ticket", "search_similar_jql", "code_trace_lsp"],
  effective_step: "code_trace_lsp",
  fix_approach: "Added nil check + ErrPipelineNotFound",
  files_changed: [
    { path: "pipeline/handler.go", summary: "nil check after FindByID" },
    { path: "pipeline/service.go", summary: "new ErrPipelineNotFound sentinel" }
  ],
  ci_attempts: 1
})

LLM -> "Resolved CI-20712. PR #4521 created, CI passing, ticket in review."
```
