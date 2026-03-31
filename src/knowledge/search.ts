import { runQuery } from "./graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  resolution_type: string;
  error_signature: string;
  root_cause: string;
  fix_approach: string;
  files_changed: string[];
  confidence: number;
  ticket: string | null;
  pr_url: string | null;
  repo: string | null;
  source_team?: string;
}

// ---------------------------------------------------------------------------
// Vector similarity search (team-scoped)
// ---------------------------------------------------------------------------

export async function searchSimilar(params: {
  embedding: number[];
  teamId: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const { embedding, teamId, limit = 5 } = params;

  const cypher = `
    CALL db.index.vector.queryNodes('error_embedding', toInteger($limit), $embedding)
    YIELD node AS similar_error, score
    MATCH (similar_error)<-[:HAS_ERROR]-(res:Resolution)-[:SCOPED_TO]->(t:Team {id: $teamId})
    WHERE res.status IN ['confirmed_resolved', 'merged', 'pending']
    MATCH (res)-[:HAS_FIX]->(fix:Fix)
    OPTIONAL MATCH (res)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
    OPTIONAL MATCH (fix)-[:CHANGED]->(f:File)
    OPTIONAL MATCH (res)-[:FOR_TICKET]->(tk:Ticket)
    OPTIONAL MATCH (res)-[:HAS_PR]->(pr:PR)
    OPTIONAL MATCH (pr)-[:IN_REPO]->(repo:Repo)
    RETURN
      res.resolution_type     AS resolution_type,
      similar_error.signature AS error_signature,
      rc.description          AS root_cause,
      fix.approach            AS fix_approach,
      collect(DISTINCT f.path) AS files_changed,
      score                   AS confidence,
      tk.id                   AS ticket,
      pr.url                  AS pr_url,
      repo.name               AS repo
    ORDER BY score DESC
  `;

  const records = await runQuery(cypher, { embedding, teamId, limit });
  return records.map(toSearchResult);
}

// ---------------------------------------------------------------------------
// File-based search
// ---------------------------------------------------------------------------

export async function searchByFile(params: {
  filePaths: string[];
  teamId: string;
  repo?: string;
}): Promise<SearchResult[]> {
  const { filePaths, teamId, repo } = params;

  const repoFilter = repo
    ? `MATCH (pr)-[:IN_REPO]->(repo:Repo) WHERE repo.name = $repo`
    : `OPTIONAL MATCH (pr)-[:IN_REPO]->(repo:Repo)`;

  const cypher = `
    MATCH (f:File) WHERE f.path IN $filePaths
    MATCH (fix:Fix)-[:CHANGED]->(f)
    MATCH (res:Resolution)-[:HAS_FIX]->(fix)
    MATCH (res)-[:SCOPED_TO]->(t:Team {id: $teamId})
    OPTIONAL MATCH (res)-[:HAS_ERROR]->(err:Error)
    OPTIONAL MATCH (res)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
    OPTIONAL MATCH (fix)-[:CHANGED]->(allFiles:File)
    OPTIONAL MATCH (res)-[:FOR_TICKET]->(tk:Ticket)
    OPTIONAL MATCH (res)-[:HAS_PR]->(pr:PR)
    ${repoFilter}
    RETURN
      res.resolution_type            AS resolution_type,
      err.signature                  AS error_signature,
      rc.description                 AS root_cause,
      fix.approach                   AS fix_approach,
      collect(DISTINCT allFiles.path) AS files_changed,
      1.0                            AS confidence,
      tk.id                          AS ticket,
      pr.url                         AS pr_url,
      repo.name                      AS repo
  `;

  const records = await runQuery(cypher, { filePaths, teamId, repo: repo ?? "" });
  return records.map(toSearchResult);
}

// ---------------------------------------------------------------------------
// Module-based search
// ---------------------------------------------------------------------------

export async function searchByModule(params: {
  moduleName: string;
  teamId: string;
}): Promise<SearchResult[]> {
  const { moduleName, teamId } = params;

  const cypher = `
    MATCH (m:Module {name: $moduleName})<-[:BELONGS_TO]-(f:File)
          <-[:CHANGED]-(fix:Fix)<-[:HAS_FIX]-(res:Resolution)
          -[:SCOPED_TO]->(t:Team {id: $teamId})
    OPTIONAL MATCH (res)-[:HAS_ERROR]->(err:Error)
    OPTIONAL MATCH (res)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
    OPTIONAL MATCH (fix)-[:CHANGED]->(allFiles:File)
    OPTIONAL MATCH (res)-[:FOR_TICKET]->(tk:Ticket)
    OPTIONAL MATCH (res)-[:HAS_PR]->(pr:PR)
    OPTIONAL MATCH (pr)-[:IN_REPO]->(repo:Repo)
    RETURN
      res.resolution_type            AS resolution_type,
      err.signature                  AS error_signature,
      rc.description                 AS root_cause,
      fix.approach                   AS fix_approach,
      collect(DISTINCT allFiles.path) AS files_changed,
      1.0                            AS confidence,
      tk.id                          AS ticket,
      pr.url                         AS pr_url,
      repo.name                      AS repo
  `;

  const records = await runQuery(cypher, { moduleName, teamId });
  return records.map(toSearchResult);
}

// ---------------------------------------------------------------------------
// Error-type search
// ---------------------------------------------------------------------------

export async function searchByErrorType(params: {
  errorType: string;
  teamId: string;
}): Promise<SearchResult[]> {
  const { errorType, teamId } = params;

  const cypher = `
    MATCH (err:Error)<-[:HAS_ERROR]-(res:Resolution)-[:SCOPED_TO]->(t:Team {id: $teamId})
    WHERE toLower(err.signature) CONTAINS toLower($errorType)
    MATCH (res)-[:HAS_FIX]->(fix:Fix)
    OPTIONAL MATCH (res)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
    WITH res, err, fix, head(collect(rc)) AS rc
    OPTIONAL MATCH (fix)-[:CHANGED]->(f:File)
    WITH res, err, fix, rc, collect(DISTINCT f.path) AS files_changed
    OPTIONAL MATCH (res)-[:FOR_TICKET]->(tk:Ticket)
    WITH res, err, fix, rc, files_changed, head(collect(tk)) AS tk
    OPTIONAL MATCH (res)-[:HAS_PR]->(pr:PR)
    WITH res, err, fix, rc, files_changed, tk, head(collect(pr)) AS pr
    OPTIONAL MATCH (pr)-[:IN_REPO]->(repo:Repo)
    WITH res, err, fix, rc, files_changed, tk, pr, head(collect(repo)) AS repo
    RETURN
      res.resolution_type          AS resolution_type,
      err.signature                AS error_signature,
      rc.description               AS root_cause,
      fix.approach                 AS fix_approach,
      files_changed,
      1.0                          AS confidence,
      tk.id                        AS ticket,
      pr.url                       AS pr_url,
      repo.name                    AS repo
    ORDER BY res.created_at DESC
    LIMIT 10
  `;

  const records = await runQuery(cypher, { errorType, teamId });
  return records.map(toSearchResult);
}

// ---------------------------------------------------------------------------
// Cross-team search (global + other teams)
// ---------------------------------------------------------------------------

export async function searchCrossTeam(params: {
  embedding: number[];
  teamId: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const { embedding, teamId, limit = 5 } = params;

  const cypher = `
    CALL db.index.vector.queryNodes('error_embedding', toInteger($limit * 2), $embedding)
    YIELD node AS similar_error, score
    MATCH (similar_error)<-[:HAS_ERROR]-(res:Resolution)
    WHERE res.status IN ['confirmed_resolved', 'merged']
      AND NOT EXISTS {
        MATCH (res)-[:SCOPED_TO]->(t:Team {id: $teamId})
        WHERE NOT EXISTS { MATCH (res)-[:SCOPED_TO]->(t2:Team) WHERE t2.id <> $teamId }
      }
    MATCH (res)-[:HAS_FIX]->(fix:Fix)
    OPTIONAL MATCH (res)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
    OPTIONAL MATCH (fix)-[:CHANGED]->(f:File)
    OPTIONAL MATCH (res)-[:FOR_TICKET]->(tk:Ticket)
    OPTIONAL MATCH (res)-[:HAS_PR]->(pr:PR)
    OPTIONAL MATCH (pr)-[:IN_REPO]->(repo:Repo)
    OPTIONAL MATCH (res)-[:SCOPED_TO]->(srcTeam:Team)
    RETURN
      res.resolution_type           AS resolution_type,
      similar_error.signature       AS error_signature,
      rc.description                AS root_cause,
      fix.approach                  AS fix_approach,
      collect(DISTINCT f.path)      AS files_changed,
      score                         AS confidence,
      tk.id                         AS ticket,
      pr.url                        AS pr_url,
      repo.name                     AS repo,
      srcTeam.name                  AS source_team
    ORDER BY score DESC
    LIMIT toInteger($limit)
  `;

  const records = await runQuery(cypher, { embedding, teamId, limit });
  return records.map((rec) => ({
    ...toSearchResult(rec),
    source_team: (rec.get("source_team") as string | null) ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Full-text search
// ---------------------------------------------------------------------------

export async function searchFullText(params: {
  query: string;
  teamId: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const { query, teamId, limit = 10 } = params;

  const cypher = `
    CALL db.index.fulltext.queryNodes('error_fulltext', $query)
    YIELD node AS err, score
    MATCH (err)<-[:HAS_ERROR]-(res:Resolution)-[:SCOPED_TO]->(t:Team {id: $teamId})
    MATCH (res)-[:HAS_FIX]->(fix:Fix)
    OPTIONAL MATCH (res)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
    OPTIONAL MATCH (fix)-[:CHANGED]->(f:File)
    OPTIONAL MATCH (res)-[:FOR_TICKET]->(tk:Ticket)
    OPTIONAL MATCH (res)-[:HAS_PR]->(pr:PR)
    OPTIONAL MATCH (pr)-[:IN_REPO]->(repo:Repo)
    RETURN
      res.resolution_type          AS resolution_type,
      err.signature                AS error_signature,
      rc.description               AS root_cause,
      fix.approach                 AS fix_approach,
      collect(DISTINCT f.path)     AS files_changed,
      score                        AS confidence,
      tk.id                        AS ticket,
      pr.url                       AS pr_url,
      repo.name                    AS repo
    ORDER BY score DESC
    LIMIT toInteger($limit)
  `;

  const records = await runQuery(cypher, { query, teamId, limit });
  return records.map(toSearchResult);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSearchResult(rec: import("neo4j-driver").Record): SearchResult {
  return {
    resolution_type: (rec.get("resolution_type") as string) ?? "code_fix",
    error_signature: (rec.get("error_signature") as string) ?? "",
    root_cause: (rec.get("root_cause") as string) ?? "",
    fix_approach: (rec.get("fix_approach") as string) ?? "",
    files_changed: ((rec.get("files_changed") as string[]) ?? []).filter(Boolean),
    confidence: rec.get("confidence") as number,
    ticket: (rec.get("ticket") as string | null) ?? null,
    pr_url: (rec.get("pr_url") as string | null) ?? null,
    repo: (rec.get("repo") as string | null) ?? null,
  };
}
