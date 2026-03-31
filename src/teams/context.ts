import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { searchSimilar, type SearchResult } from "../knowledge/search.js";
import { getPatterns } from "../knowledge/patterns.js";
import { runQuery } from "../knowledge/graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamConfig {
  team: { id: string; name: string };
  tracker: {
    provider: string;
    jira?: {
      cloud_id: string;
      default_project: string;
      default_issue_type: string;
      statuses: Record<string, string>;
      custom_fields: Record<string, unknown>;
    };
  };
  ci: {
    max_fix_attempts: number;
    providers: {
      name: string;
      detect_by: string;
      pr_tool?: string;
      mcp_prefix?: string;
      default_org_id?: string;
      default_project_id?: string;
      gcp_bucket?: string;
      log_path_format?: string;
      pr_url_format?: string;
      pr_url_format_with_scope?: string;
    }[];
  };
  git: {
    base_branch: string;
    branch_format: string;
    commit_format: string;
    pr_sections: string[];
  };
  build: {
    auto_detect: boolean;
    commands?: Record<string, string>;
  };
  code_style?: {
    language: string;
    test_approach: string;
    review_checklist: string[];
  };
  issue_patterns?: {
    pattern: string;
    typical_root_cause: string;
    typical_fix_area: string[];
  }[];
  repositories?: {
    github?: { owner: string; repo: string }[];
    harness_code?: {
      base_url: string;
      repos: string[];
    };
  };
  modules?: {
    name: string;
    path_prefixes: string[];
    primary_team?: string;
    teams?: string[];
    shared?: boolean;
  }[];
}

export interface ShipContext {
  team_config: TeamConfig;
  similar_resolutions: SearchResult[];
  patterns: { description: string; occurrences: number; success_rate: number; typical_fix: string }[];
  investigation_hints: string[];
}

// ---------------------------------------------------------------------------
// Config cache
// ---------------------------------------------------------------------------

const configCache = new Map<string, TeamConfig>();

import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEAMS_DIR = path.resolve(__dirname, "../../teams");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Query procedural memory for effective investigation steps.
 * Returns steps sorted by success rate.
 */
async function getEffectiveSteps(teamId: string): Promise<string[]> {
  try {
    const records = await runQuery(
      `MATCH (res:Resolution)-[:SCOPED_TO]->(t:Team {id: $teamId})
       WHERE res.status = 'confirmed_resolved' AND res.effective_step IS NOT NULL
       RETURN res.effective_step AS step,
              avg(res.time_to_root_cause_minutes) AS avg_time,
              count(*) AS occurrences
       ORDER BY avg_time ASC
       LIMIT 5`,
      { teamId },
    );

    return records.map(
      (r) => `${r.get("step") as string} (avg ${Math.round(r.get("avg_time") as number)}min, used ${r.get("occurrences")} times)`,
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a team configuration from the teams/ YAML directory.
 * Results are cached in memory for subsequent calls.
 */
export async function loadTeamConfig(teamId: string): Promise<TeamConfig> {
  const cached = configCache.get(teamId);
  if (cached) {
    return cached;
  }

  const filePath = path.join(TEAMS_DIR, `${teamId}.yaml`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `Invalid team config for "${teamId}": expected an object, got ${typeof parsed}`,
    );
  }

  const config = parsed as TeamConfig;
  configCache.set(teamId, config);
  return config;
}

/**
 * Build a full ShipContext for the given team and optional input.
 *
 * - Loads team config (cached).
 * - If input and embedding are provided, searches for similar past resolutions.
 * - Finds matching patterns from the knowledge graph.
 * - Queries procedural memory for effective investigation steps.
 */
export async function getContext(params: {
  teamId: string;
  input?: string;
  errorText?: string;
  embedding?: number[];
}): Promise<ShipContext> {
  const { teamId, input, errorText, embedding } = params;

  const teamConfig = await loadTeamConfig(teamId);

  // Search for similar resolutions when we have input + embedding
  let similarResolutions: SearchResult[] = [];
  if (embedding) {
    similarResolutions = await searchSimilar({ embedding, teamId });
  }

  // Find matching patterns for this team
  const rawPatterns = await getPatterns(teamId, 10);
  const patterns = rawPatterns.map((p) => ({
    description: p.error_signature,
    occurrences: p.occurrences,
    success_rate: p.success_rate,
    typical_fix: p.fix_approach,
  }));

  // Merge pattern-based hints with procedural memory
  const patternHints = rawPatterns.map(
    (p) => `Pattern "${p.error_signature}" (${p.occurrences}x, ${Math.round(p.success_rate * 100)}% success): ${p.fix_approach}`,
  );
  const proceduralHints = await getEffectiveSteps(teamId);

  // Combine team-specific issue_patterns as additional hints
  const issuePatternHints: string[] = [];
  const queryText = errorText ?? input;
  if (teamConfig.issue_patterns && queryText) {
    for (const ip of teamConfig.issue_patterns) {
      const regex = new RegExp(ip.pattern, "i");
      if (regex.test(queryText)) {
        issuePatternHints.push(
          `Likely root cause: ${ip.typical_root_cause}. Check: ${ip.typical_fix_area.join(", ")}`,
        );
      }
    }
  }

  const investigationHints = [
    ...issuePatternHints,
    ...patternHints,
    ...proceduralHints,
  ];

  return {
    team_config: teamConfig,
    similar_resolutions: similarResolutions,
    patterns,
    investigation_hints: investigationHints,
  };
}
