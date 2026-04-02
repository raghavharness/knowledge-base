import { v4 as uuid } from "uuid";
import { runWrite, runQuery } from "./graph.js";
import { generateEmbedding } from "./embeddings.js";
import { createOrUpdatePattern } from "./patterns.js";
import { checkPromotionEligibility } from "./promotion.js";
import { isValidPrUrl, extractPrNumber, extractRepoFromUrl, extractRepoUrl } from "./url-utils.js";

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
  session_id?: string;
  ticket_id?: string;
  ticket_summary?: string;
  ticket_assignee?: string;
  pr_url?: string;
  pr_title?: string;
  pr_author?: string;
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
  updated: boolean;
  patterns_updated: number;
  similar_resolutions_linked: number;
}

export async function recordResolution(input: RecordInput): Promise<RecordResult> {
  // Deduplication priority:
  // 1. session_id match — same session, always update in place
  // 2. ticket_id match within same team — context-compaction-safe dedup;
  //    an agent resuming after compaction won't remember session_id but
  //    will still pass the same ticket_id, so we merge into the existing record
  // 3. Neither — create new
  let resolutionId: string | undefined;
  let isUpdate = false;

  // Priority 1: session_id — exact session match
  if (input.session_id) {
    const bySession = await runQuery(
      `MATCH (r:Resolution {session_id: $sessionId}) RETURN r.id AS id LIMIT 1`,
      { sessionId: input.session_id },
    );
    if (bySession.length > 0) {
      resolutionId = bySession[0].get("id") as string;
      isUpdate = true;
    }
  }

  // Priority 2: ticket_id — one resolution per ticket per team, always.
  // Runs when session_id is absent OR when session_id was given but found no match
  // (e.g. new session working on the same ticket, or after context compaction).
  if (!isUpdate && input.ticket_id) {
    const byTicket = await runQuery(
      `MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team {id: $teamId})
       MATCH (r)-[:HAS_TICKET]->(tk:Ticket {ticket_id: $ticketId})
       RETURN r.id AS id ORDER BY r.created_at DESC LIMIT 1`,
      { teamId: input.teamId, ticketId: input.ticket_id },
    );
    if (byTicket.length > 0) {
      resolutionId = byTicket[0].get("id") as string;
      isUpdate = true;
    }
  }

  // Priority 3: create new
  if (!resolutionId) {
    resolutionId = uuid();
  }

  // Generate embeddings
  const [errorEmbedding, resolutionEmbedding] = await Promise.all([
    generateEmbedding(input.error_signature),
    generateEmbedding(`${input.error_signature} ${input.root_cause} ${input.fix_approach}`),
  ]);

  // For updates, read existing root_cause/fix_approach so we can append to them
  let existingRootCause = "";
  let existingFixApproach = "";
  if (isUpdate) {
    const prev = await runQuery(
      `MATCH (res:Resolution {id: $resolutionId})
       OPTIONAL MATCH (res)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
       OPTIONAL MATCH (res)-[:HAS_FIX]->(f:Fix)
       RETURN rc.description AS root_cause, f.approach AS fix_approach`,
      { resolutionId },
    );
    if (prev.length > 0) {
      existingRootCause = (prev[0].get("root_cause") as string | null) ?? "";
      existingFixApproach = (prev[0].get("fix_approach") as string | null) ?? "";
    }
  }

  // When updating, combine previous and new root_cause/fix_approach if they differ
  const appendLabel = input.session_id ? "Additional finding (same session)" : "Additional finding (resumed after compaction)";
  const combinedRootCause = isUpdate && existingRootCause && existingRootCause !== input.root_cause
    ? `${existingRootCause}\n\n--- ${appendLabel} ---\n${input.root_cause}`
    : input.root_cause;
  const combinedFixApproach = isUpdate && existingFixApproach && existingFixApproach !== input.fix_approach
    ? `${existingFixApproach}\n\n--- ${appendLabel} ---\n${input.fix_approach}`
    : input.fix_approach;

  if (isUpdate) {
    // Delete old Error/RootCause/Fix nodes so they can be recreated fresh
    await runWrite(
      `MATCH (res:Resolution {id: $resolutionId})
       OPTIONAL MATCH (res)-[re:HAS_ERROR]->(e:Error)
       OPTIONAL MATCH (res)-[rrc:HAS_ROOT_CAUSE]->(rc:RootCause)
       OPTIONAL MATCH (res)-[rf:HAS_FIX]->(f:Fix)
       OPTIONAL MATCH (res)-[rcf:CHANGED_FILE]->()
       OPTIONAL MATCH (res)-[ram:AFFECTS_MODULE]->()
       DELETE re, e, rrc, rc, rf, f, rcf, ram`,
      { resolutionId },
    );

    // Update the Resolution node properties.
    // investigation_path is appended (new steps only) so the full lifecycle is preserved.
    await runWrite(
      `MATCH (res:Resolution {id: $resolutionId})
       SET res.summary = $summary,
           res.category = $category,
           res.resolution_type = $resolutionType,
           res.input_type = $inputType,
           res.ci_attempts = $ciAttempts,
           res.investigation_path = res.investigation_path + [step IN $investigationPath WHERE NOT step IN res.investigation_path],
           res.effective_step = CASE WHEN $effectiveStep <> '' THEN $effectiveStep ELSE res.effective_step END,
           res.time_to_root_cause_minutes = CASE WHEN $timeToRootCause > 0 THEN res.time_to_root_cause_minutes + $timeToRootCause ELSE res.time_to_root_cause_minutes END,
           res.knowledge_used = $knowledgeUsed,
           res.embedding = $resolutionEmbedding,
           res.updated_at = datetime()`,
      {
        resolutionId,
        summary: input.ticket_summary ?? input.error_signature,
        category: resolutionTypeToCategory(input.resolution_type),
        resolutionType: input.resolution_type ?? "code_fix",
        inputType: input.input_type,
        ciAttempts: input.ci_attempts,
        investigationPath: input.investigation_path,
        effectiveStep: input.effective_step ?? "",
        timeToRootCause: input.time_to_root_cause_minutes ?? 0,
        knowledgeUsed: input.knowledge_used ? JSON.stringify(input.knowledge_used) : "[]",
        resolutionEmbedding,
      },
    );
  } else {
    // Create new Resolution node
    await runWrite(
      `
      CREATE (res:Resolution {
        id: $resolutionId,
        source: 'agent',
        summary: $summary,
        category: $category,
        resolution_type: $resolutionType,
        session_id: $sessionId,
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

      // Link to User
      WITH res
      MATCH (u:User {id: $userId})
      CREATE (res)-[:CREATED_BY]->(u)

      // Link to Team
      WITH res
      MATCH (t:Team {id: $teamId})
      CREATE (res)-[:SCOPED_TO]->(t)

      RETURN true AS success
      `,
      {
        resolutionId,
        summary: input.ticket_summary ?? input.error_signature,
        category: resolutionTypeToCategory(input.resolution_type),
        resolutionType: input.resolution_type ?? "code_fix",
        sessionId: input.session_id ?? null,
        inputType: input.input_type,
        ciAttempts: input.ci_attempts,
        investigationPath: input.investigation_path,
        effectiveStep: input.effective_step ?? "",
        timeToRootCause: input.time_to_root_cause_minutes ?? 0,
        knowledgeUsed: input.knowledge_used ? JSON.stringify(input.knowledge_used) : "[]",
        userId: input.userId,
        teamId: input.teamId,
        resolutionEmbedding,
      },
    );
  }

  // Recreate Error, RootCause, Fix nodes (same for both create and update paths)
  await runWrite(
    `
    MATCH (res:Resolution {id: $resolutionId})

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

    CREATE (res)-[:HAS_ERROR]->(err)
    CREATE (res)-[:HAS_ROOT_CAUSE]->(rc)
    CREATE (res)-[:HAS_FIX]->(fix)

    // Create File nodes and link
    WITH res, fix
    UNWIND CASE WHEN $filesChanged = [] THEN [null] ELSE $filesChanged END AS fc
    WITH res, fix, fc WHERE fc IS NOT NULL
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
    MERGE (res)-[:CHANGED_FILE]->(f)

    // Map files to modules
    WITH f
    MATCH (m:Module)
    WHERE any(prefix IN m.path_prefixes WHERE f.path STARTS WITH prefix)
    MERGE (f)-[:BELONGS_TO]->(m)

    RETURN true AS success
    `,
    {
      resolutionId,
      errorSignature: input.error_signature,
      rootCause: combinedRootCause,
      rootCauseCategory: categorizeRootCause(combinedRootCause),
      fixApproach: combinedFixApproach,
      diffSummary: input.diff_summary ?? "",
      errorEmbedding,
      filesChanged: input.files_changed,
    },
  );

  // Ticket node
  if (input.ticket_id) {
    const project = input.ticket_id.split("-")[0];
    await runWrite(
      `
      MERGE (t:Ticket {ticket_id: $ticketId})
      ON CREATE SET t.id = randomUUID(), t.provider = 'jira', t.project = $project
      SET t.summary = CASE WHEN $ticketSummary IS NOT NULL THEN $ticketSummary ELSE t.summary END,
          t.assignee = CASE WHEN $assignee IS NOT NULL THEN $assignee ELSE t.assignee END
      WITH t
      MATCH (res:Resolution {id: $resolutionId})
      MERGE (res)-[:HAS_TICKET]->(t)
      `,
      { ticketId: input.ticket_id, ticketSummary: input.ticket_summary ?? null, assignee: input.ticket_assignee ?? null, project, resolutionId },
    );
  }

  // PR node (validate URL is an actual PR, not a JIRA link)
  if (input.pr_url && isValidPrUrl(input.pr_url)) {
    await runWrite(
      `
      MERGE (pr:PR {url: $prUrl})
      ON CREATE SET pr.number = toInteger($prNumber), pr.repo = $prRepo
      SET pr.title = CASE WHEN $prTitle IS NOT NULL THEN $prTitle ELSE pr.title END,
          pr.author = CASE WHEN $prAuthor IS NOT NULL THEN $prAuthor ELSE pr.author END
      WITH pr
      MATCH (res:Resolution {id: $resolutionId})
      MERGE (res)-[:HAS_PR]->(pr)

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
        prTitle: input.pr_title ?? null,
        prAuthor: input.pr_author ?? null,
        repoUrl: extractRepoUrl(input.pr_url),
        resolutionId,
      },
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
    { embedding: errorEmbedding, resolutionId },
  );

  for (const record of similar) {
    await runWrite(
      `
      MATCH (a:Resolution {id: $resolutionId}), (b:Resolution {id: $otherId})
      MERGE (a)-[:SIMILAR_TO {confidence: $confidence}]->(b)
      `,
      { resolutionId, otherId: record.get("otherId"), confidence: record.get("score") },
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
    updated: isUpdate,
    patterns_updated: patternsUpdated,
    similar_resolutions_linked: similarCount,
  };
}

function resolutionTypeToCategory(resolutionType?: string): string {
  switch (resolutionType) {
    case "code_fix": return "bugfix";
    case "config_change": return "config_change";
    case "knowledge_gap": return "knowledge_gap";
    case "expected_behavior": return "bugfix";
    case "documentation": return "documentation";
    case "environment": return "config_change";
    default: return "bugfix";
  }
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
