# Design: `ship_ingest_jira` MCP Prompt

**Date**: 2026-03-30
**Type**: MCP Prompt (client-side orchestration)
**Scope**: New prompt registration on ship-server; no changes to existing ingestion pipeline

---

## Problem

Ingesting JIRA tickets and PRs into the Ship knowledge graph currently requires manual pre-processing — the calling LLM must fetch ticket/PR data itself, extract structured fields, and call `ship_ingest`. There's no guided workflow for this, making it error-prone and inconsistent.

## Solution

A new MCP **prompt** (`ship_ingest_jira`) registered on the ship-server. When invoked, it returns a structured instruction template that tells the calling LLM exactly how to fetch, extract, and ingest data from JIRA tickets and/or PRs using existing MCP tools.

## Input Parameters

| Parameter   | Required | Type   | Description |
|-------------|----------|--------|-------------|
| `input`     | Yes      | string | Single ticket ID (`CI-21042`), comma-separated list (`CI-21042, CI-21058`), JQL query (`project = CI AND resolved >= -7d`), PR URL(s) (`https://github.com/org/repo/pull/123`), or mixed |
| `pr_source` | No       | string | `"github"`, `"harness"`, or `"both"`. Default: read from team config via `ship_context`, fall back to `"both"` |

## Bidirectional Detection Logic

The prompt instructs the LLM to:

### 1. Parse Input

Classify each item in the input:
- **Ticket ID**: matches pattern `[A-Z]+-\d+` (e.g., `CI-21042`)
- **PR URL**: contains `github.com` or `app.harness.io`
- **JQL query**: anything else (passed to `searchJiraIssuesUsingJql`, capped at 50 results)

### 2. JIRA Ticket -> PRs (forward direction)

For each ticket ID:
1. Fetch ticket details via `mcp__atlassian__getJiraIssue`
2. Find associated PRs:
   - **Dev panel links**: `mcp__atlassian__getJiraIssueRemoteIssueLinks` — extract PR URLs
   - **Search fallback**: Search for the ticket ID in PR titles/branches:
     - GitHub: `mcp__github__search_pull_requests` with query `<ticket-id>`
     - Harness: `mcp__harness__harness_search` with query `<ticket-id>`
3. Fetch full PR details from matched platform(s)

### 3. PR URL -> JIRA Tickets (reverse direction)

For each PR URL:
1. Detect platform from URL and fetch PR details:
   - GitHub: `mcp__github__pull_request_read`
   - Harness: `mcp__harness__harness_get`
2. Extract ticket IDs by scanning (regex `[A-Z]+-\d+`):
   - PR title
   - Branch name
   - PR body/description
3. Fetch each detected JIRA ticket via `mcp__atlassian__getJiraIssue`

### 4. Deduplication

If a ticket and its PR are both explicitly in the input, merge them into a single `IngestionRecord` rather than processing twice.

### 5. PR Platform Resolution Order

1. If `pr_source` parameter is provided -> use that
2. Else check team config (from `ship_context` response) for PR platform preference
3. Else default to `"both"`

## Extraction Rules

The prompt includes detailed rules for the LLM to extract `IngestionRecord` fields:

### Category Classification
| Signal | Category |
|--------|----------|
| Ticket type is "Bug" | `bugfix` |
| Ticket type is "Story" or "Task" | `feature` |
| Labels or title contain "refactor" | `refactor` |
| Title/description contain "config", "env", "environment variable", "settings" | `config_change` |

### Field Extraction

- **error_signature**: Look for stack traces, error logs, or error messages in ticket description, ticket comments, and PR body. Use the most specific error message available (e.g., `"TypeError: Cannot read properties of undefined (reading 'get')"` not just `"TypeError"`).
- **root_cause**: Check PR description, ticket resolution field, and comments for phrases like "root cause", "caused by", "the issue was", "this happened because". If a PR description has a "## Root Cause" or "## Why" section, prefer that.
- **fix_approach**: PR title + PR description summary. If the PR has a "## Solution" or "## Fix" section, prefer that. Fall back to ticket resolution field.
- **pr_files_changed**: From PR diff file list. Each entry needs `path`, `change_type` ("added"/"modified"/"deleted"), and `summary` (one-line description of what changed in that file).
- **pr_diff_summary**: High-level summary of the overall diff (2-3 sentences).
- **modules**: Infer from file paths (e.g., `src/ingestion/` -> module "ingestion"). Include confidence (0.0-1.0) and reason.
- **extraction_confidence**: LLM self-rates 0.0-1.0:
  - 0.9-1.0: Clear error, clear fix, well-documented ticket and PR
  - 0.7-0.8: Most fields populated but some inferred
  - 0.5-0.6: Sparse ticket, PR exists but minimal description
  - 0.3-0.4: Very little signal, mostly guessing
  - Below 0.3: Insufficient data, will be skipped by quality gate
- **has_clear_error**: `true` if a specific error message or stack trace was found
- **has_clear_fix**: `true` if the fix approach is concrete and actionable (not just "fixed it")
- **cross_module**: `true` if files span multiple modules/directories

## Worked Examples (included in prompt)

### Example 1: Bugfix with GitHub PR (high confidence)

**JIRA Ticket CI-21042:**
- Type: Bug
- Summary: "ship_ingest fails with pattern_embedding_index not found"
- Description: "Error during ingestion: `Failed to invoke procedure db.index.vector.queryNodes: java.lang.IllegalArgumentException: There is no such vector schema index: pattern_embedding_index`"
- Status: Done, Resolution: Fixed

**Linked PR:** `https://github.com/org/ship-server/pull/47`
- Title: "fix: correct vector index name in pattern detection"
- Files: `src/knowledge/patterns.ts`
- Diff: Changed `pattern_embedding_index` to `pattern_embedding`

**Extracted IngestionRecord:**
```json
{
  "source_type": "jira_ticket",
  "ticket_id": "CI-21042",
  "ticket_summary": "ship_ingest fails with pattern_embedding_index not found",
  "ticket_status": "Done",
  "ticket_resolution": "Fixed",
  "pr_url": "https://github.com/org/ship-server/pull/47",
  "pr_title": "fix: correct vector index name in pattern detection",
  "pr_state": "merged",
  "pr_diff_summary": "Fixed vector index name mismatch — code referenced 'pattern_embedding_index' but schema creates 'pattern_embedding'",
  "pr_files_changed": [
    { "path": "src/knowledge/patterns.ts", "change_type": "modified", "summary": "Changed vector index name from pattern_embedding_index to pattern_embedding" }
  ],
  "pr_repo": "org/ship-server",
  "error_signature": "java.lang.IllegalArgumentException: There is no such vector schema index: pattern_embedding_index",
  "root_cause": "Vector index name mismatch between schema definition (pattern_embedding) and query code (pattern_embedding_index)",
  "fix_approach": "Corrected the index name in the Cypher query to match the schema definition",
  "category": "bugfix",
  "modules": [{ "name": "knowledge", "confidence": 0.95, "reason": "File in src/knowledge/" }],
  "extraction_confidence": 0.95,
  "has_clear_error": true,
  "has_clear_fix": true,
  "cross_module": false
}
```

### Example 2: Feature ticket with Harness PR (lower confidence)

**JIRA Ticket CD-3010:**
- Type: Story
- Summary: "Add retry logic for webhook delivery"
- Description: "We need retry with exponential backoff for failed webhook deliveries"
- Status: Done, Resolution: Done

**Linked PR (Harness):** pipeline `webhook-service`, PR #89
- Title: "feat: add webhook retry with exponential backoff"
- Files: `src/webhooks/deliver.ts`, `src/webhooks/retry.ts`, `src/config/defaults.ts`

**Extracted IngestionRecord:**
```json
{
  "source_type": "jira_ticket",
  "ticket_id": "CD-3010",
  "ticket_summary": "Add retry logic for webhook delivery",
  "ticket_status": "Done",
  "ticket_resolution": "Done",
  "pr_url": "https://app.harness.io/ng/account/.../pull/89",
  "pr_title": "feat: add webhook retry with exponential backoff",
  "pr_state": "merged",
  "pr_diff_summary": "Added retry mechanism with exponential backoff for webhook delivery failures, with configurable max retries and base delay",
  "pr_files_changed": [
    { "path": "src/webhooks/deliver.ts", "change_type": "modified", "summary": "Added retry wrapper around delivery call" },
    { "path": "src/webhooks/retry.ts", "change_type": "added", "summary": "New retry utility with exponential backoff" },
    { "path": "src/config/defaults.ts", "change_type": "modified", "summary": "Added webhook retry config defaults" }
  ],
  "pr_repo": "webhook-service",
  "error_signature": null,
  "root_cause": null,
  "fix_approach": "Implemented retry with exponential backoff (max 3 retries, base delay 1s) for failed webhook HTTP deliveries",
  "category": "feature",
  "modules": [
    { "name": "webhooks", "confidence": 0.9, "reason": "Primary files in src/webhooks/" },
    { "name": "config", "confidence": 0.6, "reason": "Config defaults modified" }
  ],
  "extraction_confidence": 0.65,
  "has_clear_error": false,
  "has_clear_fix": true,
  "cross_module": true
}
```

## Implementation Scope

| Change | File | Description |
|--------|------|-------------|
| New    | `src/mcp/prompts.ts` | Defines the `ship_ingest_jira` prompt with all instructions, extraction rules, and examples |
| Edit   | `src/mcp/server.ts`   | Import and call `registerPrompts(server)` alongside `registerTools(server)` |

No changes to:
- Existing ingestion pipeline (`src/ingestion/`)
- Existing MCP tools (`src/mcp/tools.ts`)
- Neo4j schema (`cypher/schema.cypher`)
- Quality gate (`src/ingestion/quality.ts`)

## Flow Diagram

```
User invokes prompt with input
        |
        v
Parse input -> classify each item
        |
   +---------+---------+
   |         |         |
Ticket ID  PR URL   JQL query
   |         |         |
   v         v         v
Fetch JIRA  Fetch PR  Search JIRA
ticket      details   via JQL
   |         |         |
   v         v         v
Find PRs    Extract   Get ticket
(dev panel  ticket    IDs from
+ search)   IDs from  results
   |        PR title/  |
   |        branch/    |
   |        body       |
   v         v         v
Fetch PR   Fetch     [recurse:
details    JIRA      ticket->PR
           tickets   flow]
   |         |         |
   +----+----+---------+
        |
        v
  Deduplicate pairs
        |
        v
  Extract IngestionRecord
  fields per extraction rules
        |
        v
  Call ship_ingest with
  assembled records array
```
