// ============================================================================
// Investigation Effectiveness
// Best investigation method for a given error type/pattern
// Parameters: $pattern_id
// ============================================================================

MATCH (pat:Pattern {id: $pattern_id})-[:MATCHES]->(err:Error)
MATCH (err)-[:RESOLVED_BY]->(res:Resolution)
WHERE res.status IN ['confirmed_resolved', 'merged']
  AND res.effective_step IS NOT NULL
  AND res.time_to_root_cause_minutes IS NOT NULL

WITH
  res.effective_step              AS investigation_step,
  count(res)                      AS times_used,
  avg(res.time_to_root_cause_minutes) AS avg_time_to_root_cause_minutes,
  min(res.time_to_root_cause_minutes) AS min_time_minutes,
  max(res.time_to_root_cause_minutes) AS max_time_minutes,
  collect(DISTINCT res.id)[..5]   AS example_resolution_ids

RETURN
  investigation_step,
  times_used,
  round(avg_time_to_root_cause_minutes, 2) AS avg_time_to_root_cause_minutes,
  min_time_minutes,
  max_time_minutes,
  example_resolution_ids
ORDER BY avg_time_to_root_cause_minutes ASC
