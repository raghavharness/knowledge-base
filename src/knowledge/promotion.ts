import { runQuery, runWrite } from "./graph.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File path segments that indicate shared/platform code. */
const SHARED_PATH_SEGMENTS = ["commons/", "platform/", "utils/", "shared/"];

/** Minimum cross-team occurrences required for automatic promotion. */
const MIN_CROSS_TEAM_OCCURRENCES = 2;

/** Minimum success rate required for automatic promotion. */
const MIN_SUCCESS_RATE = 0.8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromotionCheck {
  eligible: boolean;
  reasons: string[];
  resolution_id: string;
}

// ---------------------------------------------------------------------------
// Check promotion eligibility
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a resolution should be promoted to the global namespace.
 *
 * All four rules must be satisfied:
 *   1. Resolution status is 'confirmed_resolved'
 *   2. Fix touches shared code (commons/, platform/, utils/, shared/)
 *   3. The underlying pattern has occurred 2+ times across different teams
 *   4. Pattern success rate >= 0.8
 */
export async function checkPromotionEligibility(
  resolutionId: string,
): Promise<PromotionCheck> {
  const reasons: string[] = [];

  // Fetch the resolution, its changed files, and associated pattern data
  const cypher = `
    MATCH (res:Resolution {id: $resolutionId})
    OPTIONAL MATCH (res)-[:CHANGED]->(f:File)
    OPTIONAL MATCH (error:Error)-[:RESOLVED_BY]->(res)
    OPTIONAL MATCH (error)-[:MATCHES_PATTERN]->(p:Pattern)
    OPTIONAL MATCH (p2:Pattern)
      WHERE p2.error_signature = p.error_signature
        AND p2.team_id <> p.team_id
    RETURN
      res.status                        AS status,
      collect(DISTINCT f.path)          AS files,
      p.success_rate                    AS success_rate,
      p.occurrences                     AS occurrences,
      count(DISTINCT p2)                AS cross_team_pattern_count,
      p.team_id                         AS pattern_team
  `;

  const records = await runQuery(cypher, { resolutionId });

  if (records.length === 0) {
    return {
      eligible: false,
      reasons: [`Resolution ${resolutionId} not found`],
      resolution_id: resolutionId,
    };
  }

  const rec = records[0];
  const status = rec.get("status") as string | null;
  const files = (rec.get("files") as string[]).filter(Boolean);
  const successRate = rec.get("success_rate") as number | null;
  const crossTeamCount = (rec.get("cross_team_pattern_count") as number) ?? 0;

  // Rule 1: confirmed_resolved
  const isConfirmed = status === "confirmed_resolved";
  if (!isConfirmed) {
    reasons.push(
      `Status is '${status ?? "unknown"}', requires 'confirmed_resolved'`,
    );
  }

  // Rule 2: touches shared code
  const touchesShared = files.some((fp) =>
    SHARED_PATH_SEGMENTS.some((seg) => fp.includes(seg)),
  );
  if (!touchesShared) {
    reasons.push(
      "Fix does not touch shared code (commons/, platform/, utils/, shared/)",
    );
  }

  // Rule 3: 2+ cross-team occurrences
  // Count includes the pattern's own team + other teams' matching patterns
  const totalTeams = crossTeamCount + 1; // +1 for the source team's own pattern
  const enoughCrossTeam = totalTeams >= MIN_CROSS_TEAM_OCCURRENCES;
  if (!enoughCrossTeam) {
    reasons.push(
      `Pattern seen in ${totalTeams} team(s), requires ${MIN_CROSS_TEAM_OCCURRENCES}+`,
    );
  }

  // Rule 4: success rate
  const highEnoughRate = (successRate ?? 0) >= MIN_SUCCESS_RATE;
  if (!highEnoughRate) {
    reasons.push(
      `Success rate is ${((successRate ?? 0) * 100).toFixed(0)}%, requires ${MIN_SUCCESS_RATE * 100}%+`,
    );
  }

  const eligible = isConfirmed && touchesShared && enoughCrossTeam && highEnoughRate;

  return { eligible, reasons, resolution_id: resolutionId };
}

// ---------------------------------------------------------------------------
// Promote to global
// ---------------------------------------------------------------------------

/**
 * Promotes a resolution to the global namespace.
 *
 * - Removes the team SCOPED_TO relationship from the Error
 * - Sets `global: true` on the Error and Resolution nodes
 * - Records promotion timestamp
 *
 * Only promotes if all eligibility rules pass.
 */
export async function promoteToGlobal(resolutionId: string): Promise<void> {
  const check = await checkPromotionEligibility(resolutionId);

  if (!check.eligible) {
    throw new Error(
      `Resolution ${resolutionId} is not eligible for promotion: ${check.reasons.join("; ")}`,
    );
  }

  await applyPromotion(resolutionId);
}

/**
 * Force-promotes a resolution to global, bypassing eligibility checks.
 * Intended for team leads / admin overrides.
 */
export async function manualPromote(resolutionId: string): Promise<void> {
  await applyPromotion(resolutionId);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function applyPromotion(resolutionId: string): Promise<void> {
  const cypher = `
    MATCH (res:Resolution {id: $resolutionId})
    OPTIONAL MATCH (error:Error)-[:RESOLVED_BY]->(res)

    // Remove team scoping
    OPTIONAL MATCH (error)-[scoped:SCOPED_TO]->(:Team)
    DELETE scoped

    // Mark as global
    SET error.global    = true,
        res.global      = true,
        res.promoted_at = datetime()
  `;

  await runWrite(cypher, { resolutionId });
}
