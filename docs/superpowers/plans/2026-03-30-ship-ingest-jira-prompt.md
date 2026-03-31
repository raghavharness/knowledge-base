# `ship_ingest_jira` MCP Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register a new MCP prompt on ship-server that guides the calling LLM to fetch JIRA tickets and/or PRs, extract structured `IngestionRecord` fields, and call `ship_ingest`.

**Architecture:** A single new file `src/mcp/prompts.ts` exports a `registerPrompts` function that registers the `ship_ingest_jira` prompt with the MCP server. The prompt accepts `input` (ticket IDs, PR URLs, JQL, or mixed) and optional `pr_source`, and returns a multi-message instruction template. `src/mcp/server.ts` is edited to call `registerPrompts`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (McpServer.prompt API), Zod for argument schemas.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/mcp/prompts.ts` | Defines the `ship_ingest_jira` prompt — argument schema, instruction template builder, extraction rules, worked examples |
| Modify | `src/mcp/server.ts` | Import `registerPrompts` and call it alongside `registerTools` |

---

### Task 1: Create `src/mcp/prompts.ts` with prompt registration

**Files:**
- Create: `src/mcp/prompts.ts`

- [ ] **Step 1: Create the prompts file with the prompt registration**

Create `src/mcp/prompts.ts` with the following content:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  server.prompt(
    "ship_ingest_jira",
    "Ingest JIRA tickets and/or PRs into the Ship knowledge graph. Accepts ticket IDs, PR URLs, JQL queries, or a mix. Guides you through fetching all data, extracting structured fields, and calling ship_ingest.",
    {
      input: z
        .string()
        .describe(
          'Ticket ID(s), PR URL(s), JQL query, or mixed. Examples: "CI-21042", "CI-21042, CI-21058", "project = CI AND resolved >= -7d", "https://github.com/org/repo/pull/123", or a mix of these.',
        ),
      pr_source: z
        .enum(["github", "harness", "both"])
        .optional()
        .describe(
          'Where to search for PRs. Default: read from team config, fall back to "both".',
        ),
    },
    async ({ input, pr_source }) => {
      const prSourceInstruction = pr_source
        ? `The user specified pr_source="${pr_source}". Only search for PRs on: ${pr_source === "both" ? "GitHub AND Harness" : pr_source}.`
        : `No pr_source was specified. Check the team config from ship_context for a PR platform preference. If none is configured, search BOTH GitHub and Harness.`;

      const systemPrompt = buildSystemPrompt(prSourceInstruction);

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Ingest the following into the Ship knowledge graph:\n\n${input}`,
            },
          },
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: systemPrompt,
            },
          },
        ],
      };
    },
  );
}

function buildSystemPrompt(prSourceInstruction: string): string {
  return `I'll ingest these into the Ship knowledge graph. Let me follow the ingestion workflow step by step.

${prSourceInstruction}

## My Workflow

### Step 1: Parse Input

I'll classify each item in the input:
- **Ticket ID**: matches pattern \`[A-Z]+-\\d+\` (e.g., \`CI-21042\`)
- **PR URL**: contains \`github.com\` or \`app.harness.io\`
- **JQL query**: anything else — I'll pass it to \`mcp__atlassian__searchJiraIssuesUsingJql\` (cap at 50 results)

### Step 2: Fetch Data (Bidirectional)

**For each Ticket ID:**
1. Fetch ticket details via \`mcp__atlassian__getJiraIssue\`
2. Find associated PRs:
   a. Check dev panel links: \`mcp__atlassian__getJiraIssueRemoteIssueLinks\` — extract PR URLs
   b. Search fallback — search for the ticket ID in PR titles/branches:
      - GitHub: \`mcp__github__search_pull_requests\` with query containing the ticket ID
      - Harness: \`mcp__harness0__harness_search\` with query containing the ticket ID
3. For each PR found, fetch full details:
   - GitHub PRs: \`mcp__github__pull_request_read\`
   - Harness PRs: \`mcp__harness0__harness_get\`

**For each PR URL:**
1. Detect platform from URL and fetch PR details:
   - GitHub (\`github.com\`): \`mcp__github__pull_request_read\`
   - Harness (\`app.harness.io\`): \`mcp__harness0__harness_get\`
2. Extract ticket IDs by scanning (regex \`[A-Z]+-\\d+\`) the PR title, branch name, and body/description
3. For each detected ticket ID: fetch via \`mcp__atlassian__getJiraIssue\`

**For JQL queries:**
1. Run \`mcp__atlassian__searchJiraIssuesUsingJql\` with the query (max 50 results)
2. For each returned ticket, follow the "For each Ticket ID" flow above

### Step 3: Deduplicate

If a ticket and its PR both appear in the input, merge them into a single record.

### Step 4: Extract IngestionRecord Fields

For each ticket+PR pair (or standalone ticket/PR), I'll extract structured fields following these rules:

#### Category Classification
| Signal | Category |
|--------|----------|
| Ticket type is "Bug" | \`bugfix\` |
| Ticket type is "Story" or "Task" | \`feature\` |
| Labels or title contain "refactor" | \`refactor\` |
| Title/description contain "config", "env", "environment variable", "settings" | \`config_change\` |
| Default if unclear | \`feature\` |

#### Field Extraction Rules
- **error_signature**: Look for stack traces, error logs, or error messages in ticket description, ticket comments, and PR body. Use the most specific error message (e.g., \`"TypeError: Cannot read properties of undefined (reading 'get')"\` not just \`"TypeError"\`).
- **root_cause**: Check PR description, ticket resolution field, and comments for "root cause", "caused by", "the issue was", "this happened because". Prefer PR sections titled "## Root Cause" or "## Why".
- **fix_approach**: PR title + description summary. Prefer PR sections titled "## Solution" or "## Fix". Fall back to ticket resolution field.
- **pr_files_changed**: From PR diff file list. Each entry: \`{ path, change_type: "added"|"modified"|"deleted", summary }\`.
- **pr_diff_summary**: 2-3 sentence high-level summary of overall diff.
- **modules**: Infer from file paths (e.g., \`src/ingestion/\` → module "ingestion"). Include \`confidence\` (0.0-1.0) and \`reason\`.
- **extraction_confidence**: Self-rate 0.0-1.0:
  - 0.9-1.0: Clear error, clear fix, well-documented
  - 0.7-0.8: Most fields populated, some inferred
  - 0.5-0.6: Sparse ticket, PR exists but minimal description
  - 0.3-0.4: Very little signal
  - Below 0.3: Insufficient data (will be skipped by quality gate)
- **has_clear_error**: \`true\` if a specific error message or stack trace was found
- **has_clear_fix**: \`true\` if the fix approach is concrete and actionable
- **cross_module**: \`true\` if changed files span multiple top-level directories

### Step 5: Call ship_ingest

Assemble all extracted records into an array and call \`mcp__ship__ship_ingest\` with the token and records.

Report results: how many ingested, skipped, errored, with details for each ticket/PR.

---

## Worked Examples

### Example 1: Bugfix with GitHub PR (high confidence)

**JIRA CI-21042** (Bug): "ship_ingest fails with pattern_embedding_index not found"
- Description mentions: \`java.lang.IllegalArgumentException: There is no such vector schema index: pattern_embedding_index\`
- Status: Done, Resolution: Fixed
- Linked PR: \`https://github.com/org/ship-server/pull/47\` — "fix: correct vector index name in pattern detection", changed \`src/knowledge/patterns.ts\`

**Extracted record:**
\`\`\`json
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
\`\`\`

### Example 2: Feature with Harness PR (lower confidence)

**JIRA CD-3010** (Story): "Add retry logic for webhook delivery"
- Description: "We need retry with exponential backoff for failed webhook deliveries"
- Status: Done
- Linked PR (Harness): PR #89 — "feat: add webhook retry with exponential backoff"

**Extracted record:**
\`\`\`json
{
  "source_type": "jira_ticket",
  "ticket_id": "CD-3010",
  "ticket_summary": "Add retry logic for webhook delivery",
  "ticket_status": "Done",
  "ticket_resolution": "Done",
  "pr_url": "https://app.harness.io/ng/account/.../pull/89",
  "pr_title": "feat: add webhook retry with exponential backoff",
  "pr_state": "merged",
  "pr_diff_summary": "Added retry mechanism with exponential backoff for webhook delivery failures",
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
\`\`\`

Now let me start executing. First, I'll parse the input and fetch all the data.`;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/raghav/ship-server && npx tsc --noEmit src/mcp/prompts.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/prompts.ts
git commit -m "feat: add ship_ingest_jira MCP prompt for JIRA/PR ingestion"
```

---

### Task 2: Wire up prompts in server.ts

**Files:**
- Modify: `src/mcp/server.ts:4` (add import)
- Modify: `src/mcp/server.ts:12` (add registerPrompts call)

- [ ] **Step 1: Add import for registerPrompts**

In `src/mcp/server.ts`, add after line 4 (`import { registerTools } from "./tools.js";`):

```typescript
import { registerPrompts } from "./prompts.js";
```

- [ ] **Step 2: Call registerPrompts alongside registerTools**

In `src/mcp/server.ts`, after line 12 (`registerTools(server);`), add:

```typescript
  registerPrompts(server);
```

- [ ] **Step 3: Verify the full project compiles**

Run: `cd /Users/raghav/ship-server && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: wire up ship_ingest_jira prompt in MCP server"
```

---

### Task 3: Build and deploy to EC2

**Files:** None (deployment only)

- [ ] **Step 1: Build locally**

Run: `cd /Users/raghav/ship-server && npm run build`
Expected: Clean build with `dist/` output including `dist/mcp/prompts.js`.

- [ ] **Step 2: Rsync to EC2**

```bash
rsync -avz --exclude='node_modules' --exclude='.git' \
  -e 'ssh -i ~/Downloads/raghavfinalpem.pem -o StrictHostKeyChecking=no' \
  /Users/raghav/ship-server/ \
  ubuntu@ec2-44-204-197-57.compute-1.amazonaws.com:~/ship-server/
```

Expected: Files transferred including new `src/mcp/prompts.ts` and `dist/mcp/prompts.js`.

- [ ] **Step 3: Rebuild and restart Docker container**

```bash
ssh -i ~/Downloads/raghavfinalpem.pem -o StrictHostKeyChecking=no \
  ubuntu@ec2-44-204-197-57.compute-1.amazonaws.com \
  "cd ~/ship-server && docker compose up -d --build ship-server"
```

Expected: Image rebuilds, container recreated, started successfully.

- [ ] **Step 4: Verify health check**

```bash
ssh -i ~/Downloads/raghavfinalpem.pem -o StrictHostKeyChecking=no \
  ubuntu@ec2-44-204-197-57.compute-1.amazonaws.com \
  "curl -s http://localhost:3847/health"
```

Expected: `{"status":"ok","service":"ship-server","version":"1.0.0"}`
