// ============================================================================
// Ingestion Statistics
// Multiple queries for monitoring ingestion health
// ============================================================================


// ---------------------------------------------------------------------------
// 1. Total resolutions by source (agent vs ingested)
// ---------------------------------------------------------------------------

// :query resolutions-by-source
MATCH (r:Resolution)
RETURN
  r.source      AS source,
  count(r)      AS total_resolutions,
  min(r.created_at) AS earliest,
  max(r.created_at) AS latest
ORDER BY total_resolutions DESC;


// ---------------------------------------------------------------------------
// 2. Resolutions by category (bugfix, feature, etc.)
// ---------------------------------------------------------------------------

// :query resolutions-by-category
MATCH (r:Resolution)
RETURN
  r.category    AS category,
  count(r)      AS total_resolutions
ORDER BY total_resolutions DESC;


// ---------------------------------------------------------------------------
// 3. Resolutions by quality tier
// ---------------------------------------------------------------------------

// :query resolutions-by-quality
MATCH (r:Resolution)
RETURN
  r.quality_tier AS quality_tier,
  count(r)       AS total_resolutions,
  avg(r.confidence_score) AS avg_confidence
ORDER BY total_resolutions DESC;


// ---------------------------------------------------------------------------
// 4. Top modules by resolution count
// ---------------------------------------------------------------------------

// :query top-modules
MATCH (mod:Module)-[:CONTAINS]->(f:File)<-[:MODIFIED]-(fix:Fix)<-[:APPLIED_FIX]-(r:Resolution)
RETURN
  mod.name       AS module_name,
  count(DISTINCT r) AS resolution_count,
  count(DISTINCT f) AS files_touched
ORDER BY resolution_count DESC
LIMIT 20;


// ---------------------------------------------------------------------------
// 5. Coverage gaps (modules with fewer than 10 resolutions)
// ---------------------------------------------------------------------------

// :query coverage-gaps
MATCH (mod:Module)
OPTIONAL MATCH (mod)-[:CONTAINS]->(f:File)<-[:MODIFIED]-(fix:Fix)<-[:APPLIED_FIX]-(r:Resolution)
WITH mod, count(DISTINCT r) AS resolution_count
WHERE resolution_count < 10
RETURN
  mod.name         AS module_name,
  resolution_count AS resolution_count
ORDER BY resolution_count ASC;
