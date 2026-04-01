import { runQuery } from "../knowledge/graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoWatermark {
  repo: string;
  last_merged_at: string;
}

export interface IngestionStats {
  total_resolutions: number;
  by_source: { agent: number; ingested: number };
  by_category: {
    bugfix: number;
    feature: number;
    refactor: number;
    config_change: number;
  };
  by_quality: { high: number; medium: number; low: number };
  top_modules: { name: string; resolution_count: number }[];
  coverage_gaps: { module: string; reason: string }[];
  recent_ingestions: {
    ticket_id: string;
    ingested_at: string;
    confidence: number;
  }[];
  watermarks: RepoWatermark[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toInt(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return Number(value) || 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve ingestion statistics and coverage analysis for a team.
 *
 * Queries Neo4j for:
 *  - Total resolutions by source and category
 *  - Quality tier distribution
 *  - Top modules by resolution count
 *  - Coverage gaps (modules with fewer than 10 resolutions)
 *  - Recent ingestions
 */
export async function getIngestionStats(params: {
  teamId: string;
  since?: string;
}): Promise<IngestionStats> {
  const { teamId, since } = params;

  const sinceFilter = since
    ? "AND r.created_at >= $since"
    : "";

  // --- Total resolutions by source ---
  const sourceRecords = await runQuery(
    `MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team { id: $teamId })
     WHERE true ${sinceFilter}
     RETURN r.source AS source, count(r) AS cnt`,
    { teamId, since: since ?? null },
  );

  let agentCount = 0;
  let ingestedCount = 0;
  for (const record of sourceRecords) {
    const source = record.get("source") as string;
    const cnt = toInt(record.get("cnt"));
    if (source === "agent") agentCount = cnt;
    else if (source === "ingested") ingestedCount = cnt;
  }

  // --- By category ---
  const categoryRecords = await runQuery(
    `MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team { id: $teamId })
     WHERE true ${sinceFilter}
     RETURN r.category AS category, count(r) AS cnt`,
    { teamId, since: since ?? null },
  );

  const byCategory = { bugfix: 0, feature: 0, refactor: 0, config_change: 0 };
  for (const record of categoryRecords) {
    const cat = record.get("category") as string;
    const cnt = toInt(record.get("cnt"));
    if (cat in byCategory) {
      byCategory[cat as keyof typeof byCategory] = cnt;
    }
  }

  // --- By quality tier ---
  const qualityRecords = await runQuery(
    `MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team { id: $teamId })
     WHERE true ${sinceFilter}
     RETURN r.quality_tier AS tier, count(r) AS cnt`,
    { teamId, since: since ?? null },
  );

  const byQuality = { high: 0, medium: 0, low: 0 };
  for (const record of qualityRecords) {
    const tier = toInt(record.get("tier"));
    const cnt = toInt(record.get("cnt"));
    if (tier === 1) byQuality.high = cnt;
    else if (tier === 2) byQuality.medium = cnt;
    else if (tier === 3) byQuality.low = cnt;
  }

  // --- Top modules ---
  const moduleRecords = await runQuery(
    `MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team { id: $teamId }),
           (r)-[:AFFECTS_MODULE]->(m:Module)
     WHERE true ${sinceFilter}
     RETURN m.name AS name, count(r) AS cnt
     ORDER BY cnt DESC
     LIMIT 20`,
    { teamId, since: since ?? null },
  );

  const topModules: { name: string; resolution_count: number }[] = [];
  for (const record of moduleRecords) {
    topModules.push({
      name: record.get("name") as string,
      resolution_count: toInt(record.get("cnt")),
    });
  }

  // --- Coverage gaps: modules with < 10 resolutions ---
  const gapRecords = await runQuery(
    `MATCH (m:Module)-[:OWNED_BY]->(t:Team { id: $teamId })
     OPTIONAL MATCH (r:Resolution)-[:AFFECTS_MODULE]->(m)
     WITH m.name AS name, count(r) AS cnt
     WHERE cnt < 10
     RETURN name, cnt
     ORDER BY cnt ASC`,
    { teamId },
  );

  const coverageGaps: { module: string; reason: string }[] = [];
  for (const record of gapRecords) {
    const name = record.get("name") as string;
    const cnt = toInt(record.get("cnt"));
    coverageGaps.push({
      module: name,
      reason: `Only ${cnt} resolution(s) — below minimum coverage threshold of 10`,
    });
  }

  // --- Recent ingestions ---
  const recentRecords = await runQuery(
    `MATCH (r:Resolution { source: "ingested" })-[:SCOPED_TO]->(t:Team { id: $teamId })
     OPTIONAL MATCH (r)-[:HAS_TICKET]->(ticket:Ticket)
     WHERE true ${sinceFilter}
     RETURN ticket.ticket_id AS ticket_id, r.created_at AS ingested_at, r.confidence AS confidence
     ORDER BY r.created_at DESC
     LIMIT 50`,
    { teamId, since: since ?? null },
  );

  const recentIngestions: {
    ticket_id: string;
    ingested_at: string;
    confidence: number;
  }[] = [];
  for (const record of recentRecords) {
    recentIngestions.push({
      ticket_id: (record.get("ticket_id") as string) ?? "",
      ingested_at: (record.get("ingested_at") as string) ?? "",
      confidence: toInt(record.get("confidence")),
    });
  }

  // --- Watermarks: latest pr_merged_at per repo ---
  const watermarkRecords = await runQuery(
    `MATCH (r:Resolution)-[:HAS_PR]->(p:PR)
     MATCH (r)-[:SCOPED_TO]->(t:Team { id: $teamId })
     WHERE p.repo IS NOT NULL AND p.merged_at IS NOT NULL
     RETURN p.repo AS repo, max(toString(p.merged_at)) AS last_merged_at
     ORDER BY repo`,
    { teamId },
  );

  const watermarks: RepoWatermark[] = [];
  for (const record of watermarkRecords) {
    watermarks.push({
      repo: record.get("repo") as string,
      last_merged_at: record.get("last_merged_at") as string,
    });
  }

  return {
    total_resolutions: agentCount + ingestedCount,
    by_source: { agent: agentCount, ingested: ingestedCount },
    by_category: byCategory,
    by_quality: byQuality,
    top_modules: topModules,
    coverage_gaps: coverageGaps,
    recent_ingestions: recentIngestions,
    watermarks,
  };
}
