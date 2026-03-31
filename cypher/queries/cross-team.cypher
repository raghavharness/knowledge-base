// ============================================================================
// Cross-Team Search
// Find similar errors across ALL teams + global knowledge
// Parameters: $error_embedding, $limit
// ============================================================================

CALL db.index.vector.queryNodes('error_embedding', $limit * 3, $error_embedding)
YIELD node AS similar_error, score

MATCH (similar_error)-[:RESOLVED_BY]->(res:Resolution)
WHERE res.status IN ['confirmed_resolved', 'merged']

// Include resolutions that are either:
//   1. Scoped to any team (cross-team)
//   2. Global (no team scope or explicitly marked global)
OPTIONAL MATCH (res)-[:SCOPED_TO]->(team:Team)

WITH similar_error, res, score, team
WHERE team IS NOT NULL OR res.global = true

OPTIONAL MATCH (res)-[:APPLIED_FIX]->(fix:Fix)
OPTIONAL MATCH (fix)-[:MODIFIED]->(file:File)
OPTIONAL MATCH (res)-[:IDENTIFIED_ROOT_CAUSE]->(rc:RootCause)

RETURN
  similar_error.signature     AS error_signature,
  similar_error.message       AS error_message,
  score                       AS similarity_score,
  res.id                      AS resolution_id,
  res.status                  AS resolution_status,
  res.summary                 AS resolution_summary,
  res.global                  AS is_global,
  team.id                     AS source_team_id,
  team.name                   AS source_team_name,
  fix.description             AS fix_description,
  collect(DISTINCT file.path) AS affected_files,
  rc.description              AS root_cause,
  rc.category                 AS root_cause_category
ORDER BY score DESC
LIMIT $limit
