// ============================================================================
// Causal Chain Traversal
// From an error, traverse Resolution -> RootCause -> CAUSED_BY chains
// Parameters: $error_signature
// ============================================================================

MATCH (err:Error {signature: $error_signature})
MATCH (err)-[:RESOLVED_BY]->(res:Resolution)
MATCH (res)-[:IDENTIFIED_ROOT_CAUSE]->(rc:RootCause)

// Variable-length traversal through CAUSED_BY chains (0..3 depth)
MATCH path = (rc)-[:CAUSED_BY*0..3]->(upstream:RootCause)

RETURN
  err.signature                 AS error_signature,
  err.message                   AS error_message,
  res.id                        AS resolution_id,
  res.summary                   AS resolution_summary,
  [node IN nodes(path) | {
    description: node.description,
    category: node.category,
    component: node.component
  }]                            AS causal_chain,
  length(path)                  AS chain_depth
ORDER BY chain_depth DESC
