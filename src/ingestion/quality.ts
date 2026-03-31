// ---------------------------------------------------------------------------
// Quality gate — tier assignment for ingested records
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestionRecord {
  source_type: "jira_ticket" | "pr";

  // JIRA ticket fields (mandatory for ingestion)
  ticket_id: string;
  ticket_summary: string;
  ticket_status?: string;
  ticket_resolution?: string;
  ticket_type?: string;
  ticket_priority?: string;
  ticket_assignee?: string;
  ticket_reporter?: string;
  ticket_created_at: string;
  ticket_resolved_at?: string;
  ticket_labels?: string[];
  ticket_components?: string[];
  ticket_description?: string;
  ticket_conclusion?: string;
  ticket_comments_summary?: string;
  ticket_feature_flag?: string;
  ticket_sprint?: string;

  // PR fields (mandatory for ingestion)
  pr_url: string;
  pr_title: string;
  pr_repo: string;
  pr_state?: string;
  pr_diff_summary?: string;
  pr_files_changed?: { path: string; change_type: string; summary: string }[];
  pr_author?: string;
  pr_reviewers?: string[];
  pr_merged_at?: string;
  pr_created_at?: string;
  pr_description?: string;
  pr_comments_summary?: string;
  pr_additions?: number;
  pr_deletions?: number;
  pr_review_decision?: string;

  // Analysis fields
  error_signature?: string;
  root_cause?: string;
  fix_approach?: string;
  category: "bugfix" | "feature" | "refactor" | "config_change";
  modules?: { name: string; confidence: number; reason: string }[];
  extraction_confidence: number;
  has_clear_error: boolean;
  has_clear_fix: boolean;
  cross_module?: boolean;
}

export interface QualityAssessment {
  tier: 1 | 2 | 3;
  skip: boolean;
  confidence: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Search weights by source / tier
// ---------------------------------------------------------------------------

export const SEARCH_WEIGHTS = {
  agent: 1.0,
  tier1: 0.9,
  tier2: 0.6,
  tier3: 0.3,
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assess the quality of an ingestion record and assign a tier.
 *
 * - Tier 1 (high, >= 0.8): clear error + clear fix + extraction_confidence >= 0.8
 * - Tier 2 (medium, 0.5–0.8): has PR with files but error/fix unclear
 * - Tier 3 (low, 0.3–0.5): minimal data, ticket only or no clear resolution
 * - Below 0.3: skip = true
 */
export function assessQuality(record: IngestionRecord): QualityAssessment {
  const { extraction_confidence, has_clear_error, has_clear_fix } = record;

  // Below minimum threshold — skip entirely
  if (extraction_confidence < 0.3) {
    return {
      tier: 3,
      skip: true,
      confidence: extraction_confidence,
      reason:
        "Extraction confidence below 0.3 threshold; insufficient data quality",
    };
  }

  // Tier 1: high quality — both clear error and fix with high confidence
  if (
    has_clear_error &&
    has_clear_fix &&
    extraction_confidence >= 0.8
  ) {
    return {
      tier: 1,
      skip: false,
      confidence: extraction_confidence,
      reason:
        "High quality: clear error signature, clear fix, and high extraction confidence",
    };
  }

  // Tier 2: medium quality — PR with changed files but error or fix unclear
  const hasPrFiles =
    record.pr_url !== undefined &&
    record.pr_files_changed !== undefined &&
    record.pr_files_changed.length > 0;

  if (hasPrFiles && extraction_confidence >= 0.5) {
    return {
      tier: 2,
      skip: false,
      confidence: extraction_confidence,
      reason:
        "Medium quality: PR with file changes present but error or fix details unclear",
    };
  }

  // Tier 3: low quality — minimal data
  return {
    tier: 3,
    skip: false,
    confidence: extraction_confidence,
    reason:
      "Low quality: minimal data available, ticket-only or no clear resolution",
  };
}
