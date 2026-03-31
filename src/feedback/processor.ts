import { getDriver } from "../knowledge/graph.js";
import { adjustPatternConfidence } from "../knowledge/patterns.js";
import {
  checkPromotionEligibility,
  manualPromote,
} from "../knowledge/promotion.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Outcome =
  | "confirmed_resolved"
  | "partial"
  | "reverted"
  | "promote_global";

export interface FeedbackResult {
  updated: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Update the status of a Resolution node and return associated pattern IDs.
 */
async function updateResolutionStatus(
  resolutionId: string,
  status: string,
): Promise<string[]> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.run(
      `MATCH (r:Resolution { id: $resolutionId })
       SET r.status = $status, r.updated_at = $now
       WITH r
       OPTIONAL MATCH (r)-[:APPLIES_PATTERN]->(p:Pattern)
       RETURN r.id AS id, collect(p.id) AS patternIds`,
      {
        resolutionId,
        status,
        now: new Date().toISOString(),
      },
    );

    if (result.records.length === 0) {
      return [];
    }

    return result.records[0].get("patternIds") as string[];
  } finally {
    await session.close();
  }
}

/**
 * Flag a resolution for investigation by adding a flag property.
 */
async function flagForInvestigation(resolutionId: string): Promise<void> {
  const driver = getDriver();
  const session = driver.session();

  try {
    await session.run(
      `MATCH (r:Resolution { id: $resolutionId })
       SET r.flagged = true,
           r.flagged_at = $now,
           r.flag_reason = "reverted"`,
      {
        resolutionId,
        now: new Date().toISOString(),
      },
    );
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process feedback for a resolution outcome.
 *
 * Handles four outcome types:
 *  - confirmed_resolved: Increases pattern confidence, checks auto-promotion.
 *  - partial: Decreases pattern confidence.
 *  - reverted: Decreases pattern confidence, flags for investigation.
 *  - promote_global: Forces manual promotion to global knowledge.
 */
export async function processFeedback(params: {
  resolutionId: string;
  outcome: Outcome;
  teamId: string;
}): Promise<FeedbackResult> {
  const { resolutionId, outcome, teamId } = params;

  // 1. Update Resolution node status
  const patternIds = await updateResolutionStatus(resolutionId, outcome);

  if (patternIds.length === 0 && outcome !== "promote_global") {
    // Resolution not found or no patterns linked
    // Still attempt update for promote_global since it may work on the resolution directly
  }

  // 2–6. Outcome-specific logic
  switch (outcome) {
    case "confirmed_resolved": {
      // Increase confidence for all associated patterns
      for (const patternId of patternIds) {
        await adjustPatternConfidence(patternId, "success");
      }

      // Check auto-promotion eligibility
      await checkPromotionEligibility(resolutionId);
      break;
    }

    case "partial":
    case "reverted": {
      // Decrease confidence for all associated patterns
      for (const patternId of patternIds) {
        await adjustPatternConfidence(patternId, "failure");
      }

      // Flag reverted resolutions for investigation
      if (outcome === "reverted") {
        await flagForInvestigation(resolutionId);
      }
      break;
    }

    case "promote_global": {
      // Force promote to global knowledge
      await manualPromote(resolutionId);
      break;
    }
  }

  return { updated: true };
}
