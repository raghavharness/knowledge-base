import { v4 as uuid } from "uuid";
import { runWrite, runQuery } from "./graph.js";
import { generateEmbedding } from "./embeddings.js";
import { createOrUpdatePattern } from "./patterns.js";
import { checkPromotionEligibility } from "./promotion.js";

export type ResolutionType = "code_fix" | "config_change" | "knowledge_gap" | "expected_behavior" | "documentation" | "environment";

export interface KnowledgeReference {
  ticket_id?: string;
  error_signature?: string;
  root_cause?: string;
  confidence?: number;
  source: "ship_context" | "ship_search";
  was_helpful: boolean;
}

export interface RecordInput {
  resolution_type?: ResolutionType;
  error_signature: string;
  input_type: string;
  ticket_id?: string;
  pr_url?: string;
  pr_repo?: string;
  root_cause: string;
  investigation_path: string[];
  effective_step?: string;
  fix_approach: string;
  files_changed: { path: string; summary: string }[];
  diff_summary?: string;
  ci_attempts: number;
  time_to_root_cause_minutes?: number;
  knowledge_used?: KnowledgeReference[];
  userId: string;
  teamId: string;
}

export interface RecordResult {
  resolution_id: string;
  patterns_updated: number;
  similar_resolutions_linked: number;
}

export async function recordResolution(input: RecordInput): Promise<RecordResult> {
  const resolutionId = uuid();

  // Generate embeddings
  const [errorEmbedding, resolutionEmbedding] = await Promise.all([
    generateEmbedding(input.error_signature),
    generateEmbedding(`${input.error_signature} ${input.root_cause} ${input.fix_approach}`),
  ]);

  // Create all nodes and relationships in a single transaction
  await runWrite(
    `
    // Create Resolution
    CREATE (res:Resolution {
      id: $resolutionId,
      source: 'agent',
      resolution_type: $resolutionType,
      status: 'pending',
      input_type: $inputType,
      created_at: datetime(),
      ci_attempts: $ciAttempts,
      investigation_path: $investigationPath,
      effective_step: $effectiveStep,
      time_to_root_cause_minutes: $timeToRootCause,
      knowledge_used: $knowledgeUsed,
      ingestion_confidence: 1.0,
      embedding: $resolutionEmbedding
    })

    // Create or merge Error
    MERGE (err:Error {signature: $errorSignature})
    ON CREATE SET err.id = randomUUID(),
                  err.message = $errorSignature,
                  err.embedding = $errorEmbedding
    ON MATCH SET err.embedding = $errorEmbedding

    // Create RootCause
    CREATE (rc:RootCause {
      id: randomUUID(),
      description: $rootCause,
      category: $rootCauseCategory
    })

    // Create Fix
    CREATE (fix:Fix {
      id: randomUUID(),
      approach: $fixApproach,
      diff_summary: $diffSummary
    })

    // Link Resolution -> Error, RootCause, Fix
    CREATE (res)-[:HAS_ERROR]->(err)
    CREATE (res)-[:HAS_ROOT_CAUSE]->(rc)
    CREATE (res)-[:HAS_FIX]->(fix)

    // Link to User
    WITH res, fix, err
    MATCH (u:User {id: $userId})
    CREATE (res)-[:CREATED_BY]->(u)

    // Link to Team
    WITH res, fix, err
    MATCH (t:Team {id: $teamId})
    CREATE (res)-[:SCOPED_TO]->(t)

    // Create File nodes and link
    WITH res, fix, err
    UNWIND $filesChanged AS fc
    MERGE (f:File {path: fc.path})
    ON CREATE SET f.language = CASE
      WHEN fc.path ENDS WITH '.go' THEN 'go'
      WHEN fc.path ENDS WITH '.ts' THEN 'typescript'
      WHEN fc.path ENDS WITH '.js' THEN 'javascript'
      WHEN fc.path ENDS WITH '.py' THEN 'python'
      WHEN fc.path ENDS WITH '.java' THEN 'java'
      ELSE 'unknown'
    END
    CREATE (fix)-[:CHANGED]->(f)

    // Map files to modules
    WITH f
    MATCH (m:Module)
    WHERE any(prefix IN m.path_prefixes WHERE f.path STARTS WITH prefix)
    MERGE (f)-[:BELONGS_TO]->(m)

    RETURN true AS success
    `,
    {
      resolutionId,
      resolutionType: input.resolution_type ?? "code_fix",
      errorSignature: input.error_signature,
      rootCause: input.root_cause,
      rootCauseCategory: categorizeRootCause(input.root_cause),
      fixApproach: input.fix_approach,
      diffSummary: input.diff_summary ?? "",
      inputType: input.input_type,
      ciAttempts: input.ci_attempts,
      investigationPath: input.investigation_path,
      effectiveStep: input.effective_step ?? "",
      timeToRootCause: input.time_to_root_cause_minutes ?? 0,
      knowledgeUsed: input.knowledge_used ? JSON.stringify(input.knowledge_used) : "[]",
      userId: input.userId,
      teamId: input.teamId,
      filesChanged: input.files_changed,
      errorEmbedding: errorEmbedding,
      resolutionEmbedding: resolutionEmbedding,
    }
  );

  // Create Ticket node if provided
  if (input.ticket_id) {
    const project = input.ticket_id.split("-")[0];
    await runWrite(
      `
      MERGE (t:Ticket {id: $ticketId})
      ON CREATE SET t.provider = 'jira', t.project = $project
      WITH t
      MATCH (res:Resolution {id: $resolutionId})
      CREATE (res)-[:FOR_TICKET]->(t)
      `,
      { ticketId: input.ticket_id, project, resolutionId }
    );
  }

  // Create PR + Repo nodes if provided
  if (input.pr_url) {
    await runWrite(
      `
      MERGE (pr:PR {url: $prUrl})
      ON CREATE SET pr.number = toInteger($prNumber), pr.repo = $prRepo
      WITH pr
      MATCH (res:Resolution {id: $resolutionId})
      CREATE (res)-[:HAS_PR]->(pr)

      // Create or merge Repo node and link PR to it
      WITH pr
      WHERE $prRepo IS NOT NULL AND $prRepo <> ''
      MERGE (repo:Repo {name: $prRepo})
      ON CREATE SET repo.url = $repoUrl, repo.created_at = datetime()
      MERGE (pr)-[:IN_REPO]->(repo)
      `,
      {
        prUrl: input.pr_url,
        prNumber: extractPrNumber(input.pr_url),
        prRepo: input.pr_repo ?? extractRepoFromUrl(input.pr_url),
        repoUrl: extractRepoUrl(input.pr_url),
        resolutionId,
      }
    );
  }

  // Find and link similar resolutions
  let similarCount = 0;
  const similar = await runQuery(
    `
    CALL db.index.vector.queryNodes('error_embedding', 5, $embedding)
    YIELD node AS similar_error, score
    WHERE score > 0.7
    MATCH (similar_error)<-[:HAS_ERROR]-(other_res:Resolution)
    WHERE other_res.id <> $resolutionId
    RETURN other_res.id AS otherId, score
    `,
    { embedding: errorEmbedding, resolutionId }
  );

  for (const record of similar) {
    await runWrite(
      `
      MATCH (a:Resolution {id: $resolutionId}), (b:Resolution {id: $otherId})
      MERGE (a)-[:SIMILAR_TO {confidence: $confidence}]->(b)
      `,
      {
        resolutionId,
        otherId: record.get("otherId"),
        confidence: record.get("score"),
      }
    );
    similarCount++;
  }

  // Detect/update patterns
  let patternsUpdated = 0;
  try {
    await createOrUpdatePattern({
      errorSignature: input.error_signature,
      teamId: input.teamId,
      rootCause: input.root_cause,
      fixApproach: input.fix_approach,
      category: input.resolution_type ?? "code_fix",
      files: input.files_changed.map((f) => f.path),
      embedding: errorEmbedding,
      resolutionId,
    });
    patternsUpdated = 1;
  } catch {
    // Pattern detection failure is non-fatal
  }

  // Check promotion eligibility (async, non-blocking)
  checkPromotionEligibility(resolutionId).catch(() => {});

  return {
    resolution_id: resolutionId,
    patterns_updated: patternsUpdated,
    similar_resolutions_linked: similarCount,
  };
}

function categorizeRootCause(rootCause: string): string {
  const lower = rootCause.toLowerCase();
  if (lower.includes("nil") || lower.includes("null") || lower.includes("undefined")) return "nil_check";
  if (lower.includes("timeout") || lower.includes("deadline")) return "timeout";
  if (lower.includes("config") || lower.includes("configuration")) return "config";
  if (lower.includes("race") || lower.includes("concurrent")) return "race_condition";
  if (lower.includes("permission") || lower.includes("auth")) return "auth";
  if (lower.includes("memory") || lower.includes("oom")) return "memory";
  if (lower.includes("network") || lower.includes("connection")) return "network";
  return "other";
}

function extractPrNumber(url: string): string {
  const match = url.match(/\/(?:pull|pulls)\/(\d+)/);
  return match ? match[1] : "0";
}

function extractRepoFromUrl(url: string): string {
  // GitHub: https://github.com/owner/repo/pull/123
  const ghMatch = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (ghMatch) return ghMatch[1];

  // Harness: .../repos/REPO_NAME/pulls/...
  const harnessMatch = url.match(/\/repos\/([^/]+)\//);
  if (harnessMatch) return harnessMatch[1];

  return "";
}

function extractRepoUrl(prUrl: string): string {
  // GitHub: return repo URL without /pull/N
  const ghMatch = prUrl.match(/(https:\/\/github\.com\/[^/]+\/[^/]+)/);
  if (ghMatch) return ghMatch[1];

  return "";
}
