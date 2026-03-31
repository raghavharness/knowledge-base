// ============================================================================
// Search Similar Past Resolutions for an Error
// Uses vector similarity + graph traversal
// Parameters: $error_embedding, $team_id, $limit
// ============================================================================

CALL db.index.vector.queryNodes('error_embedding', $limit * 3, $error_embedding)
YIELD node AS similar_error, score

// Traverse from error to resolution context
MATCH (similar_error)-[:RESOLVED_BY]->(res:Resolution)
WHERE res.status IN ['confirmed_resolved', 'merged']

// Filter by team scope
MATCH (res)-[:SCOPED_TO]->(team:Team {id: $team_id})

// Gather fix details
OPTIONAL MATCH (res)-[:APPLIED_FIX]->(fix:Fix)
OPTIONAL MATCH (fix)-[:MODIFIED]->(file:File)
OPTIONAL MATCH (res)-[:IDENTIFIED_ROOT_CAUSE]->(rc:RootCause)

RETURN
  similar_error.signature   AS error_signature,
  similar_error.message     AS error_message,
  score                     AS similarity_score,
  res.id                    AS resolution_id,
  res.status                AS resolution_status,
  res.summary               AS resolution_summary,
  res.created_at            AS resolved_at,
  fix.description           AS fix_description,
  fix.diff_summary          AS fix_diff_summary,
  collect(DISTINCT file.path) AS affected_files,
  rc.description            AS root_cause,
  rc.category               AS root_cause_category
ORDER BY score DESC
LIMIT $limit
