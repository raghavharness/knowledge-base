// ============================================================================
// Module Error Analysis
// "When module X changes, what errors appear?"
// Parameters: $module_name
// ============================================================================

MATCH (mod:Module {name: $module_name})-[:CONTAINS]->(file:File)
MATCH (file)<-[:MODIFIED]-(fix:Fix)
MATCH (fix)<-[:APPLIED_FIX]-(res:Resolution)
MATCH (err:Error)-[:RESOLVED_BY]->(res)

WITH
  err.signature AS error_signature,
  err.message   AS error_message,
  count(DISTINCT res) AS frequency,
  collect(DISTINCT file.path) AS affected_files

RETURN
  error_signature,
  error_message,
  frequency,
  affected_files
ORDER BY frequency DESC
