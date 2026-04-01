import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerUser } from "../auth/registration.js";
import { getAuthContext } from "../auth/context.js";
import { getContext } from "../teams/context.js";
import { generateEmbedding } from "../knowledge/embeddings.js";
import {
  searchSimilar,
  searchByFile,
  searchByModule,
  searchByErrorType,
  searchCrossTeam,
  searchFullText,
} from "../knowledge/search.js";
import { recordResolution } from "../knowledge/record.js";
import { processFeedback } from "../feedback/processor.js";
import { getSession, upsertSession } from "../sessions/blackboard.js";
import { processIngestion } from "../ingestion/ingest.js";
import { getIngestionStats } from "../ingestion/stats.js";

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------
export function registerTools(server: McpServer) {
  // ─── Tool 1: ship_register ──────────────────────────────────────────
  server.tool(
    "ship_register",
    "One-time user registration via Atlassian identity. Call mcp__atlassian__atlassianUserInfo() first to get your info, then pass it here.",
    {
      atlassian_id: z.string().describe("Your Atlassian account ID"),
      email: z.string().email().describe("Your Atlassian email"),
      name: z.string().describe("Your display name"),
      projects: z.array(z.string()).describe("JIRA project keys you have access to (e.g. ['CI', 'CD'])"),
    },
    async ({ atlassian_id, email, name, projects }) => {
      try {
        const reg = await registerUser({ atlassian_id, email, name, projects });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                token: reg.token,
                user_id: reg.userId,
                teams: reg.teams,
                message: "Registration successful. Save this token to ~/.ship/token or set SHIP_TOKEN env var.",
              }),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 2: ship_context ──────────────────────────────────────────
  server.tool(
    "ship_context",
    "Get team config + similar past resolutions + investigation hints. Call this at the START of every /ship run.",
    {
      token: z.string().optional().describe("JWT token — read from ~/.ship/token file (cat ~/.ship/token). If file doesn't exist, call ship_register first."),
      input: z.string().optional().describe("Ticket ID, PR URL, GCP log URL, description, or empty"),
      error_text: z.string().optional().describe("Extracted error text for better similarity search"),
    },
    async ({ token, input, error_text }) => {
      try {
        const auth = getAuthContext(token);
        let embedding: number[] | undefined;
        if (error_text) {
          embedding = await generateEmbedding(error_text);
        } else if (input) {
          embedding = await generateEmbedding(input);
        }

        const context = await getContext({
          teamId: auth.primaryTeam,
          input,
          errorText: error_text,
          embedding,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(context) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 3: ship_search ───────────────────────────────────────────
  server.tool(
    "ship_search",
    "Search knowledge graph for similar resolutions. Use mid-investigation when you need more context or hit a dead end.",
    {
      token: z.string().optional().describe("JWT token — read from ~/.ship/token file (cat ~/.ship/token). If file doesn't exist, call ship_register first."),
      query: z.string().describe("Search query — error message, file path, module name, or description"),
      strategy: z
        .enum(["semantic", "by_file", "by_module", "by_error_type", "fulltext"])
        .optional()
        .describe("Search strategy. Default: semantic"),
      cross_team: z.boolean().optional().describe("Search across all teams. Default: false"),
      file_paths: z.array(z.string()).optional().describe("File paths for by_file strategy"),
      repo: z.string().optional().describe("Filter by repository name or URL"),
    },
    async ({ token, query, strategy = "semantic", cross_team = false, file_paths, repo }) => {
      try {
        const auth = getAuthContext(token);
        const embedding = await generateEmbedding(query);

        let resolutions;
        switch (strategy) {
          case "by_file":
            resolutions = await searchByFile({ filePaths: file_paths ?? [query], teamId: auth.primaryTeam, repo });
            break;
          case "by_module":
            resolutions = await searchByModule({ moduleName: query, teamId: auth.primaryTeam });
            break;
          case "by_error_type":
            resolutions = await searchByErrorType({ errorType: query, teamId: auth.primaryTeam });
            break;
          case "fulltext":
            resolutions = await searchFullText({ query, teamId: auth.primaryTeam });
            break;
          case "semantic":
          default:
            if (cross_team) {
              resolutions = await searchCrossTeam({ embedding, teamId: auth.primaryTeam });
            } else {
              resolutions = await searchSimilar({ embedding, teamId: auth.primaryTeam });
            }
            break;
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ resolutions }) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 4: ship_record ───────────────────────────────────────────
  server.tool(
    "ship_record",
    "Record a completed resolution. ALWAYS call this after investigating any issue — whether it was a code bug, knowledge gap, config issue, or expected behavior. The server embeds, stores, and learns from it. IMPORTANT: Always try to include both JIRA ticket details (ticket_id) AND PR details (pr_url, pr_repo). If a PR was created, these fields are critical for linking the resolution to the repository. However, if no PR exists yet (e.g. still investigating), you may proceed without PR details.",
    {
      token: z.string().optional().describe("JWT token — read from ~/.ship/token file (cat ~/.ship/token). If file doesn't exist, call ship_register first."),
      resolution_type: z
        .enum(["code_fix", "config_change", "knowledge_gap", "expected_behavior", "documentation", "environment"])
        .describe("What kind of resolution this was. Use 'knowledge_gap' when the issue was a misunderstanding, 'expected_behavior' when the system was working correctly, 'documentation' when docs needed updating, 'environment' for infra/setup issues."),
      error_signature: z.string().describe("Error pattern or symptom description"),
      input_type: z
        .enum(["gcp_log", "jira_ticket", "pr", "direct", "no_input"])
        .describe("How the issue was received"),
      ticket_id: z.string().optional().describe("JIRA ticket ID if applicable"),
      ticket_summary: z.string().optional().describe("JIRA ticket title/summary (e.g. 'Fix null pointer in payment flow')"),
      ticket_assignee: z.string().optional().describe("JIRA ticket assignee name"),
      pr_url: z.string().optional().describe("Pull request URL"),
      pr_repo: z.string().optional().describe("Repository name or URL for the PR"),
      root_cause: z.string().describe("Root cause or explanation (for knowledge gaps: what the user needed to understand)"),
      investigation_path: z
        .array(z.string())
        .describe("Ordered list of investigation steps taken"),
      effective_step: z.string().optional().describe("Which investigation step found the root cause"),
      fix_approach: z.string().describe("How it was resolved (for knowledge gaps: the explanation given, doc link, or config correction)"),
      files_changed: z
        .array(z.object({ path: z.string(), summary: z.string() }))
        .describe("Files modified (can be empty for knowledge gaps or expected behavior)"),
      diff_summary: z.string().optional().describe("High-level diff summary"),
      ci_attempts: z.number().describe("Number of CI fix attempts"),
      time_to_root_cause_minutes: z.number().optional().describe("Minutes spent finding root cause"),
      knowledge_used: z
        .array(z.object({
          ticket_id: z.string().optional().describe("Ticket ID of the referenced resolution"),
          error_signature: z.string().optional().describe("Error signature of the referenced resolution"),
          root_cause: z.string().optional().describe("Root cause from the referenced resolution"),
          confidence: z.number().optional().describe("Similarity confidence score (0-1)"),
          source: z.enum(["ship_context", "ship_search"]).describe("How this reference was found"),
          was_helpful: z.boolean().describe("Whether this reference actually helped solve the issue"),
        }))
        .optional()
        .describe("Knowledge base references that were consulted during investigation. Include ALL similar resolutions returned by ship_context and ship_search, marking each as helpful or not."),
    },
    async (args) => {
      try {
        const auth = getAuthContext(args.token);
        const result = await recordResolution({
          ...args,
          userId: auth.userId,
          teamId: auth.primaryTeam,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 5: ship_feedback ─────────────────────────────────────────
  server.tool(
    "ship_feedback",
    "Report the outcome of a resolution. Helps the system learn which fixes actually work.",
    {
      token: z.string().optional().describe("JWT token — read from ~/.ship/token file (cat ~/.ship/token). If file doesn't exist, call ship_register first."),
      resolution_id: z.string().describe("Resolution ID from ship_record"),
      outcome: z
        .enum(["confirmed_resolved", "partial", "reverted", "promote_global"])
        .describe("Resolution outcome"),
    },
    async ({ token, resolution_id, outcome }) => {
      try {
        const auth = getAuthContext(token);
        const result = await processFeedback({
          resolutionId: resolution_id,
          outcome,
          teamId: auth.primaryTeam,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 6: ship_blackboard ───────────────────────────────────────
  server.tool(
    "ship_blackboard",
    "Persistent working memory per session. Survives context window compression. Also enables resuming interrupted /ship runs.",
    {
      token: z.string().optional().describe("JWT token — read from ~/.ship/token file (cat ~/.ship/token). If file doesn't exist, call ship_register first."),
      session_id: z.string().describe("Unique session ID for this /ship invocation"),
      input: z.string().optional().describe("Original input (set on first call)"),
      phase: z
        .enum(["bootstrap", "investigate", "fix", "validate", "ship", "monitor", "record"])
        .optional()
        .describe("Current workflow phase"),
      findings: z
        .record(z.unknown())
        .optional()
        .describe("Structured findings to persist. Merged with existing findings."),
    },
    async ({ token, session_id, input, phase, findings }) => {
      try {
        const auth = getAuthContext(token);

        // Read mode: only session_id provided
        if (!phase && !findings) {
          const session = await getSession(session_id, auth.primaryTeam);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(session ?? { error: "Session not found" }),
              },
            ],
          };
        }

        // Write mode: update session
        const session = await upsertSession({
          sessionId: session_id,
          teamId: auth.primaryTeam,
          userId: auth.userId,
          input,
          phase,
          findings,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(session) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 7: ship_ingest ──────────────────────────────────────────
  server.tool(
    "ship_ingest",
    "Ingest pre-processed historical data (JIRA tickets and/or PRs) into the knowledge graph. The LLM extracts structured data client-side, sends it here for storage.",
    {
      token: z.string().optional().describe("JWT token — read from ~/.ship/token file (cat ~/.ship/token). If file doesn't exist, call ship_register first."),
      records: z
        .array(
          z.object({
            source_type: z.enum(["jira_ticket", "pr"]),
            // JIRA ticket fields (mandatory)
            ticket_id: z.string().describe("JIRA ticket ID (e.g. CI-12345) — MANDATORY"),
            ticket_summary: z.string().describe("Ticket summary/title — MANDATORY"),
            ticket_status: z.string().optional(),
            ticket_resolution: z.string().optional(),
            ticket_type: z.string().optional().describe("Issue type: Bug, Story, Task, Epic"),
            ticket_priority: z.string().optional().describe("Priority: Critical, High, Medium, Low"),
            ticket_assignee: z.string().optional().describe("Assignee display name"),
            ticket_reporter: z.string().optional().describe("Reporter display name"),
            ticket_created_at: z.string().describe("Ticket creation date from JIRA (ISO format) — MANDATORY. Must come from JIRA issue's created field, not current time."),
            ticket_resolved_at: z.string().optional().describe("Ticket resolution date ISO"),
            ticket_labels: z.array(z.string()).optional().describe("JIRA labels"),
            ticket_components: z.array(z.string()).optional().describe("JIRA components"),
            ticket_description: z.string().optional().describe("Full problem statement from ticket"),
            ticket_conclusion: z.string().optional().describe("Resolution summary or final comment"),
            ticket_comments_summary: z.string().optional().describe("Summary of key discussion from comments"),
            ticket_feature_flag: z.string().optional().describe("Feature flag name if one was added"),
            ticket_sprint: z.string().optional().describe("Sprint name"),
            // PR fields (mandatory)
            pr_url: z.string().describe("Pull request URL — MANDATORY"),
            pr_title: z.string().describe("Full PR title — MANDATORY"),
            pr_repo: z.string().describe("Repository name (owner/repo or repo path) — MANDATORY"),
            pr_state: z.string().optional(),
            pr_diff_summary: z.string().optional(),
            pr_files_changed: z
              .array(z.object({ path: z.string(), change_type: z.string(), summary: z.string() }))
              .optional(),
            pr_author: z.string().optional().describe("PR author username"),
            pr_reviewers: z.array(z.string()).optional().describe("Reviewer usernames"),
            pr_merged_at: z.string().optional().describe("Merge date ISO"),
            pr_created_at: z.string().optional().describe("PR creation date ISO"),
            pr_description: z.string().optional().describe("Full PR body/description"),
            pr_comments_summary: z.string().optional().describe("Summary of key review comments"),
            pr_additions: z.number().optional().describe("Lines added"),
            pr_deletions: z.number().optional().describe("Lines deleted"),
            pr_review_decision: z.string().optional().describe("approved, changes_requested, etc."),
            // Analysis fields
            error_signature: z.string().optional(),
            root_cause: z.string().optional(),
            fix_approach: z.string().optional(),
            category: z.enum(["bugfix", "feature", "refactor", "config_change"]),
            modules: z
              .array(
                z.object({
                  name: z.string(),
                  confidence: z.number(),
                  reason: z.string(),
                })
              )
              .optional(),
            extraction_confidence: z.number(),
            has_clear_error: z.boolean(),
            has_clear_fix: z.boolean(),
            cross_module: z.boolean().optional(),
          })
        )
        .describe("Array of ingestion records"),
    },
    async ({ token, records }) => {
      try {
        const auth = getAuthContext(token);
        const result = await processIngestion(records, auth.primaryTeam, auth.userId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 8: ship_ingest_status ────────────────────────────────────
  server.tool(
    "ship_ingest_status",
    "Check ingestion statistics for a team. Shows knowledge coverage, quality distribution, and gaps.",
    {
      token: z.string().optional().describe("JWT token — read from ~/.ship/token file (cat ~/.ship/token). If file doesn't exist, call ship_register first."),
      team_id: z.string().optional().describe("Team ID. Default: caller's primary team"),
      since: z.string().optional().describe("ISO date filter. Default: all time"),
    },
    async ({ token, team_id, since }) => {
      try {
        const auth = getAuthContext(token);
        const stats = await getIngestionStats({
          teamId: team_id ?? auth.primaryTeam,
          since,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(stats) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );
}
