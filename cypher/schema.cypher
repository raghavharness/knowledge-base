// ============================================================================
// Neo4j Schema Initialization for ship-server
// ============================================================================

// ---------------------------------------------------------------------------
// Uniqueness Constraints
// ---------------------------------------------------------------------------

CREATE CONSTRAINT resolution_id_unique IF NOT EXISTS
FOR (r:Resolution) REQUIRE r.id IS UNIQUE;

CREATE CONSTRAINT user_atlassian_id_unique IF NOT EXISTS
FOR (u:User) REQUIRE u.atlassian_id IS UNIQUE;

CREATE CONSTRAINT team_id_unique IF NOT EXISTS
FOR (t:Team) REQUIRE t.id IS UNIQUE;

CREATE CONSTRAINT pattern_id_unique IF NOT EXISTS
FOR (p:Pattern) REQUIRE p.id IS UNIQUE;

CREATE CONSTRAINT ticket_id_unique IF NOT EXISTS
FOR (tk:Ticket) REQUIRE tk.id IS UNIQUE;

CREATE CONSTRAINT pr_url_unique IF NOT EXISTS
FOR (pr:PR) REQUIRE pr.url IS UNIQUE;

CREATE CONSTRAINT module_name_unique IF NOT EXISTS
FOR (m:Module) REQUIRE m.name IS UNIQUE;

CREATE CONSTRAINT repo_name_unique IF NOT EXISTS
FOR (repo:Repo) REQUIRE repo.name IS UNIQUE;

// ---------------------------------------------------------------------------
// Vector Indexes (768 dimensions, cosine similarity)
// ---------------------------------------------------------------------------

CREATE VECTOR INDEX error_embedding IF NOT EXISTS
FOR (e:Error) ON (e.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 3072,
    `vector.similarity_function`: 'cosine'
  }
};

CREATE VECTOR INDEX resolution_embedding IF NOT EXISTS
FOR (r:Resolution) ON (r.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 3072,
    `vector.similarity_function`: 'cosine'
  }
};

CREATE VECTOR INDEX pattern_embedding IF NOT EXISTS
FOR (p:Pattern) ON (p.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 3072,
    `vector.similarity_function`: 'cosine'
  }
};

// ---------------------------------------------------------------------------
// Full-Text Indexes
// ---------------------------------------------------------------------------

CREATE FULLTEXT INDEX error_fulltext IF NOT EXISTS
FOR (e:Error) ON EACH [e.signature, e.message];

// ---------------------------------------------------------------------------
// Regular Indexes (common lookups)
// ---------------------------------------------------------------------------

CREATE INDEX file_path_index IF NOT EXISTS
FOR (f:File) ON (f.path);

CREATE INDEX session_id_index IF NOT EXISTS
FOR (s:Session) ON (s.id);

CREATE INDEX repo_url_index IF NOT EXISTS
FOR (repo:Repo) ON (repo.url);
