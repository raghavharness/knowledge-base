import { runQuery, runWrite } from "./graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Pattern {
  id: string;
  error_signature: string;
  root_cause: string;
  fix_approach: string;
  category: string;
  files: string[];
  occurrences: number;
  success_rate: number;
  team_id: string;
}

const SIMILARITY_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Detect existing pattern
// ---------------------------------------------------------------------------

/**
 * Checks whether a signature matches an existing pattern for the given team
 * using vector cosine similarity (threshold 0.8).
 */
export async function detectPattern(
  errorSignature: string,
  teamId: string,
  embedding: number[],
): Promise<Pattern | null> {
  const cypher = `
    CALL db.index.vector.queryNodes('pattern_embedding', 1, $embedding)
    YIELD node AS pattern, score
    WHERE score >= $threshold
      AND pattern.team_id = $teamId
    OPTIONAL MATCH (pattern)-[:PATTERN_FILE]->(f:File)
    RETURN
      pattern.id              AS id,
      pattern.error_signature AS error_signature,
      pattern.root_cause      AS root_cause,
      pattern.fix_approach    AS fix_approach,
      pattern.category        AS category,
      collect(f.path)         AS files,
      pattern.occurrences     AS occurrences,
      pattern.success_rate    AS success_rate,
      pattern.team_id         AS team_id,
      score
    LIMIT 1
  `;

  const records = await runQuery(cypher, {
    embedding,
    teamId,
    threshold: SIMILARITY_THRESHOLD,
  });

  if (records.length === 0) {
    return null;
  }

  return recordToPattern(records[0]);
}

// ---------------------------------------------------------------------------
// Create or update pattern
// ---------------------------------------------------------------------------

/**
 * Creates a new pattern or increments the occurrence count of an existing one.
 * Uses vector similarity to decide whether to merge with an existing pattern.
 * Links the resolution to the pattern via MATCHED_PATTERN relationship.
 */
export async function createOrUpdatePattern(params: {
  errorSignature: string;
  teamId: string;
  rootCause: string;
  fixApproach: string;
  category: string;
  files: string[];
  embedding: number[];
  resolutionId: string;
}): Promise<Pattern> {
  const { errorSignature, teamId, rootCause, fixApproach, category, files, embedding, resolutionId } =
    params;

  // Try to find an existing pattern to update
  const existing = await detectPattern(errorSignature, teamId, embedding);

  if (existing) {
    // Increment occurrences on existing pattern and link resolution
    const cypher = `
      MATCH (p:Pattern {id: $patternId})
      SET p.occurrences = p.occurrences + 1,
          p.updated_at  = datetime()
      WITH p
      MATCH (r:Resolution {id: $resolutionId})
      MERGE (r)-[:MATCHED_PATTERN]->(p)
      WITH p
      OPTIONAL MATCH (p)-[:PATTERN_FILE]->(f:File)
      RETURN
        p.id              AS id,
        p.error_signature AS error_signature,
        p.root_cause      AS root_cause,
        p.fix_approach    AS fix_approach,
        p.category        AS category,
        collect(f.path)   AS files,
        p.occurrences     AS occurrences,
        p.success_rate    AS success_rate,
        p.team_id         AS team_id
    `;

    const records = await runWrite(cypher, { patternId: existing.id, resolutionId });
    if (records.length === 0) {
      return existing;
    }
    return recordToPattern(records[0]);
  }

  // Create a new pattern
  const createCypher = `
    CREATE (p:Pattern {
      id:              randomUUID(),
      error_signature: $errorSignature,
      root_cause:      $rootCause,
      fix_approach:    $fixApproach,
      category:        $category,
      team_id:         $teamId,
      occurrences:     1,
      success_rate:    1.0,
      embedding:       $embedding,
      created_at:      datetime(),
      updated_at:      datetime()
    })
    WITH p
    MATCH (r:Resolution {id: $resolutionId})
    MERGE (r)-[:MATCHED_PATTERN]->(p)
    RETURN
      p.id              AS id,
      p.error_signature AS error_signature,
      p.root_cause      AS root_cause,
      p.fix_approach    AS fix_approach,
      p.category        AS category,
      p.occurrences     AS occurrences,
      p.success_rate    AS success_rate,
      p.team_id         AS team_id
  `;

  const createRecords = await runWrite(createCypher, {
    errorSignature,
    teamId,
    rootCause,
    fixApproach,
    category,
    embedding,
    resolutionId,
  });

  const patternId = createRecords[0].get("id") as string;

  // Link files in a separate query (UNWIND on empty array is a no-op)
  if (files.length > 0) {
    await runWrite(
      `MATCH (p:Pattern {id: $patternId})
       UNWIND $files AS filePath
         MERGE (f:File {path: filePath})
         MERGE (p)-[:PATTERN_FILE]->(f)`,
      { patternId, files },
    );
  }

  return {
    id: patternId,
    error_signature: errorSignature,
    root_cause: rootCause,
    fix_approach: fixApproach,
    category,
    files,
    occurrences: 1,
    success_rate: 1.0,
    team_id: teamId,
  };
}

// ---------------------------------------------------------------------------
// Get patterns for a team
// ---------------------------------------------------------------------------

export async function getPatterns(
  teamId: string,
  limit: number = 20,
): Promise<Pattern[]> {
  const cypher = `
    MATCH (p:Pattern {team_id: $teamId})
    OPTIONAL MATCH (p)-[:PATTERN_FILE]->(f:File)
    RETURN
      p.id              AS id,
      p.error_signature AS error_signature,
      p.root_cause      AS root_cause,
      p.fix_approach    AS fix_approach,
      p.category        AS category,
      collect(f.path)   AS files,
      p.occurrences     AS occurrences,
      p.success_rate    AS success_rate,
      p.team_id         AS team_id
    ORDER BY p.occurrences DESC
    LIMIT toInteger($limit)
  `;

  const records = await runQuery(cypher, { teamId, limit });

  return records.map(recordToPattern);
}

// ---------------------------------------------------------------------------
// Adjust pattern confidence
// ---------------------------------------------------------------------------

/**
 * Updates the success_rate of a pattern based on an outcome.
 * Uses an exponential moving average (alpha = 0.3).
 */
export async function adjustPatternConfidence(
  patternId: string,
  outcome: "success" | "failure",
): Promise<void> {
  const outcomeValue = outcome === "success" ? 1.0 : 0.0;
  const alpha = 0.3;

  const cypher = `
    MATCH (p:Pattern {id: $patternId})
    SET p.success_rate = (1.0 - $alpha) * p.success_rate + $alpha * $outcomeValue,
        p.updated_at   = datetime()
  `;

  await runWrite(cypher, { patternId, alpha, outcomeValue });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordToPattern(rec: import("neo4j-driver").Record): Pattern {
  return {
    id: rec.get("id") as string,
    error_signature: rec.get("error_signature") as string,
    root_cause: rec.get("root_cause") as string,
    fix_approach: rec.get("fix_approach") as string,
    category: (rec.get("category") as string) ?? "bugfix",
    files: (rec.get("files") as string[]).filter(Boolean),
    occurrences: rec.get("occurrences") as number,
    success_rate: rec.get("success_rate") as number,
    team_id: rec.get("team_id") as string,
  };
}
