import { v4 as uuidv4 } from "uuid";
import { runQuery, runWrite, runWriteTransaction } from "../knowledge/graph.js";
import { generateEmbedding, generateEmbeddings } from "../knowledge/embeddings.js";
import { createOrUpdatePattern } from "../knowledge/patterns.js";
import { checkDuplicate } from "./dedup.js";
import { assessQuality, SEARCH_WEIGHTS, type IngestionRecord } from "./quality.js";
import { mapFilesToModules, validateLLMClassification, type TeamConfig } from "./module-mapper.js";
import { isValidPrUrl } from "../knowledge/url-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { IngestionRecord } from "./quality.js";

export interface IngestionResult {
  ingested: number;
  skipped: number;
  errors: number;
  details: {
    ticket_id?: string;
    pr_url?: string;
    status: "ingested" | "skipped" | "error";
    reason?: string;
    resolution_id?: string;
  }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load the team config from the graph. Returns module path-prefix mappings
 * needed by the module mapper.
 */
async function loadTeamConfig(
  teamId: string,
): Promise<TeamConfig> {
  const records = await runQuery(
    `MATCH (t:Team { id: $teamId })
     OPTIONAL MATCH (m:Module)-[:OWNED_BY]->(t)
     RETURN t.name AS teamName,
            collect({
              name: m.name,
              path_prefixes: m.path_prefixes,
              owner_team_id: $teamId
            }) AS modules`,
    { teamId },
  );

  if (records.length === 0) {
    return { id: teamId, name: teamId, modules: [] };
  }

  const record = records[0];
  const teamName = (record.get("teamName") as string) ?? teamId;
  const rawModules = record.get("modules") as {
    name: string | null;
    path_prefixes: string[] | null;
    owner_team_id: string;
  }[];

  const modules = rawModules
    .filter((m) => m.name !== null)
    .map((m) => ({
      name: m.name as string,
      path_prefixes: m.path_prefixes ?? [],
      owner_team_id: m.owner_team_id,
    }));

  return { id: teamId, name: teamName, modules };
}

/**
 * Upsert the Resolution node and all related nodes/relationships.
 * Uses MERGE for the Resolution so re-ingestion updates rather than duplicates.
 * Deletes old Error/RootCause/Fix/File/Module relationships before recreating.
 */
async function upsertResolutionGraph(
  resolutionId: string,
  record: IngestionRecord,
  teamId: string,
  userId: string,
  qualityTier: 1 | 2 | 3,
  confidence: number,
  moduleMappings: { moduleName: string; teamId: string }[],
): Promise<void> {
  const now = new Date().toISOString();
  // Use JIRA creation date as the Resolution's created_at (falls back to PR merge date, then current time)
  const createdAt = record.ticket_created_at ?? record.pr_merged_at ?? now;

  const searchWeight =
    qualityTier === 1
      ? SEARCH_WEIGHTS.tier1
      : qualityTier === 2
        ? SEARCH_WEIGHTS.tier2
        : SEARCH_WEIGHTS.tier3;

  await runWriteTransaction(async (tx) => {
    // Upsert Resolution node (MERGE on id)
    await tx.run(
      `MERGE (r:Resolution { id: $id })
       ON CREATE SET r.created_at = $createdAt
       SET r.source = CASE WHEN r.source = 'agent' THEN 'agent' ELSE 'ingested' END,
           r.category = $category,
           r.quality_tier = $qualityTier,
           r.confidence = $confidence,
           r.search_weight = $searchWeight,
           r.cross_module = $crossModule,
           r.summary = $summary,
           r.updated_at = $now,
           r.ingested_by = $userId`,
      {
        id: resolutionId,
        category: record.category,
        qualityTier,
        confidence,
        searchWeight,
        crossModule: record.cross_module,
        summary: record.ticket_summary ?? record.pr_title ?? null,
        createdAt,
        now,
        userId,
      },
    );

    // Delete old Error/RootCause/Fix nodes (they'll be recreated below)
    // Use DETACH DELETE so nodes with extra relationships (e.g. from patterns) are cleaned up
    await tx.run(
      `MATCH (r:Resolution { id: $resId })
       OPTIONAL MATCH (r)-[:HAS_ERROR]->(e:Error)
       OPTIONAL MATCH (r)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
       OPTIONAL MATCH (r)-[:HAS_FIX]->(f:Fix)
       DETACH DELETE e, rc, f`,
      { resId: resolutionId },
    );

    // Delete old file and module relationships (nodes are shared, only delete edges)
    await tx.run(
      `MATCH (r:Resolution { id: $resId })
       OPTIONAL MATCH (r)-[rcf:CHANGED_FILE]->()
       OPTIONAL MATCH (r)-[ram:AFFECTS_MODULE]->()
       DELETE rcf, ram`,
      { resId: resolutionId },
    );

    // Error node
    if (record.error_signature) {
      await tx.run(
        `MATCH (r:Resolution { id: $resId })
         CREATE (e:Error {
           id: $errorId,
           signature: $signature,
           created_at: $now
         })
         CREATE (r)-[:HAS_ERROR]->(e)`,
        {
          resId: resolutionId,
          errorId: uuidv4(),
          signature: record.error_signature,
          now,
        },
      );
    }

    // RootCause node
    if (record.root_cause) {
      await tx.run(
        `MATCH (r:Resolution { id: $resId })
         CREATE (rc:RootCause {
           id: $rcId,
           description: $description,
           created_at: $now
         })
         CREATE (r)-[:HAS_ROOT_CAUSE]->(rc)`,
        {
          resId: resolutionId,
          rcId: uuidv4(),
          description: record.root_cause,
          now,
        },
      );
    }

    // Fix node
    if (record.fix_approach) {
      await tx.run(
        `MATCH (r:Resolution { id: $resId })
         CREATE (f:Fix {
           id: $fixId,
           approach: $approach,
           created_at: $now
         })
         CREATE (r)-[:HAS_FIX]->(f)`,
        {
          resId: resolutionId,
          fixId: uuidv4(),
          approach: record.fix_approach,
          now,
        },
      );
    }

    // Ticket node (MERGE on ticket_id, MERGE relationship)
    if (record.ticket_id) {
      await tx.run(
        `MATCH (r:Resolution { id: $resId })
         MERGE (t:Ticket { ticket_id: $ticketId })
         ON CREATE SET t.id = $nodeId,
                       t.created_at = $now
         SET t.summary = $summary,
             t.status = $status,
             t.resolution = $resolution,
             t.type = $type,
             t.priority = $priority,
             t.assignee = CASE WHEN $assignee IS NOT NULL THEN $assignee ELSE t.assignee END,
             t.reporter = CASE WHEN $reporter IS NOT NULL THEN $reporter ELSE t.reporter END,
             t.ticket_created_at = $ticketCreatedAt,
             t.resolved_at = $resolvedAt,
             t.labels = $labels,
             t.components = $components,
             t.description = $description,
             t.conclusion = $conclusion,
             t.comments_summary = $commentsSummary,
             t.feature_flag = $featureFlag,
             t.sprint = $sprint
         MERGE (r)-[:HAS_TICKET]->(t)`,
        {
          resId: resolutionId,
          ticketId: record.ticket_id,
          nodeId: uuidv4(),
          summary: record.ticket_summary ?? null,
          status: record.ticket_status ?? null,
          resolution: record.ticket_resolution ?? null,
          type: record.ticket_type ?? null,
          priority: record.ticket_priority ?? null,
          assignee: record.ticket_assignee ?? null,
          reporter: record.ticket_reporter ?? null,
          ticketCreatedAt: record.ticket_created_at ?? null,
          resolvedAt: record.ticket_resolved_at ?? null,
          labels: record.ticket_labels ?? [],
          components: record.ticket_components ?? [],
          description: record.ticket_description ?? null,
          conclusion: record.ticket_conclusion ?? null,
          commentsSummary: record.ticket_comments_summary ?? null,
          featureFlag: record.ticket_feature_flag ?? null,
          sprint: record.ticket_sprint ?? null,
          now,
        },
      );
    }

    // PR node (MERGE on url, MERGE relationship)
    // Only create PR nodes for actual PR URLs (GitHub/Harness Code), not JIRA/Confluence links
    if (record.pr_url && isValidPrUrl(record.pr_url)) {
      await tx.run(
        `MATCH (r:Resolution { id: $resId })
         MERGE (p:PR { url: $prUrl })
         ON CREATE SET p.id = $nodeId,
                       p.created_at = $now
         SET p.title = $prTitle,
             p.state = $prState,
             p.diff_summary = $diffSummary,
             p.repo = $repo,
             p.author = CASE WHEN $author IS NOT NULL THEN $author ELSE p.author END,
             p.reviewers = $reviewers,
             p.merged_at = $mergedAt,
             p.pr_created_at = $prCreatedAt,
             p.description = $prDescription,
             p.comments_summary = $prCommentsSummary,
             p.additions = $additions,
             p.deletions = $deletions,
             p.review_decision = $reviewDecision
         MERGE (r)-[:HAS_PR]->(p)`,
        {
          resId: resolutionId,
          prUrl: record.pr_url,
          nodeId: uuidv4(),
          prTitle: record.pr_title ?? null,
          prState: record.pr_state ?? null,
          diffSummary: record.pr_diff_summary ?? null,
          repo: record.pr_repo ?? null,
          author: record.pr_author ?? null,
          reviewers: record.pr_reviewers ?? [],
          mergedAt: record.pr_merged_at ?? null,
          prCreatedAt: record.pr_created_at ?? null,
          prDescription: record.pr_description ?? null,
          prCommentsSummary: record.pr_comments_summary ?? null,
          additions: record.pr_additions ?? null,
          deletions: record.pr_deletions ?? null,
          reviewDecision: record.pr_review_decision ?? null,
          now,
        },
      );
    }

    // File nodes (from PR files changed)
    if (record.pr_files_changed && record.pr_files_changed.length > 0) {
      await tx.run(
        `MATCH (r:Resolution { id: $resId })
         UNWIND $files AS file
         MERGE (f:File { path: file.path })
         ON CREATE SET f.id = randomUUID(),
                       f.created_at = $now
         MERGE (r)-[rel:CHANGED_FILE]->(f)
         SET rel.change_type = file.change_type, rel.summary = file.summary`,
        {
          resId: resolutionId,
          files: record.pr_files_changed,
          now,
        },
      );
    }

    // SCOPED_TO team relationship (MERGE to be idempotent)
    await tx.run(
      `MATCH (r:Resolution { id: $resId })
       MERGE (t:Team { id: $teamId })
       MERGE (r)-[:SCOPED_TO]->(t)`,
      { resId: resolutionId, teamId },
    );

    // Module relationships
    for (const mod of moduleMappings) {
      if (mod.moduleName === "suggested_new_module") continue;
      await tx.run(
        `MATCH (r:Resolution { id: $resId })
         MERGE (m:Module { name: $moduleName })
         ON CREATE SET m.id = randomUUID(), m.created_at = $now
         MERGE (r)-[:AFFECTS_MODULE]->(m)`,
        {
          resId: resolutionId,
          moduleName: mod.moduleName,
          now,
        },
      );
    }
  });
}

/**
 * Search for similar resolutions by error signature and create SIMILAR_TO
 * edges.
 */
async function linkSimilarResolutions(
  resolutionId: string,
  record: IngestionRecord,
  teamId: string,
): Promise<void> {
  if (!record.error_signature) return;

  await runWrite(
    `MATCH (r1:Resolution { id: $resId })
     MATCH (r2:Resolution)-[:HAS_ERROR]->(e:Error)
     MATCH (r2)-[:SCOPED_TO]->(t:Team { id: $teamId })
     WHERE r2.id <> $resId
       AND e.signature CONTAINS $errorSubstring
     MERGE (r1)-[:SIMILAR_TO]->(r2)`,
    {
      resId: resolutionId,
      teamId,
      // Use the first 50 chars as a fuzzy match substring
      errorSubstring: record.error_signature.slice(0, 50),
    },
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process an array of ingestion records for a team.
 *
 * For each record:
 *  1. Dedup check
 *  2. Quality gate assessment
 *  3. Create Resolution + related nodes in the graph
 *  4. Generate embeddings for Error and Resolution
 *  5. Map files to modules
 *  6. Scope to team via SCOPED_TO relationship
 *  7. Link similar resolutions via SIMILAR_TO edges
 *  8. Check/update patterns
 */
export async function processIngestion(
  records: IngestionRecord[],
  teamId: string,
  userId: string,
): Promise<IngestionResult> {
  const result: IngestionResult = {
    ingested: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  // Load team config once for all records
  const teamConfig = await loadTeamConfig(teamId);

  for (const record of records) {
    try {
      // --- 0. Validate mandatory fields ---
      const missing: string[] = [];
      if (!record.pr_url) missing.push("pr_url");
      if (!record.pr_repo) missing.push("pr_repo");
      if (!record.pr_title) missing.push("pr_title");
      if (!record.ticket_id) missing.push("ticket_id");
      if (!record.ticket_summary) missing.push("ticket_summary");
      if (!record.ticket_created_at) missing.push("ticket_created_at");
      if (missing.length > 0) {
        result.skipped++;
        result.details.push({
          ticket_id: record.ticket_id,
          pr_url: record.pr_url,
          status: "skipped",
          reason: `Missing mandatory fields: ${missing.join(", ")}. During ingestion, both PR and ticket details are required.`,
        });
        continue;
      }

      // --- 1. Dedup check ---
      const dedupResult = await checkDuplicate({
        ticketId: record.ticket_id,
        prUrl: record.pr_url,
        teamId,
      });

      // --- 2. Quality gate ---
      const quality = assessQuality(record);

      if (quality.skip) {
        result.skipped++;
        result.details.push({
          ticket_id: record.ticket_id,
          pr_url: record.pr_url,
          status: "skipped",
          reason: quality.reason,
        });
        continue;
      }

      // --- 5. Map files to modules ---
      const files = record.pr_files_changed ?? [];
      const serverModules = mapFilesToModules(files, teamConfig);
      const moduleMappings = validateLLMClassification(
        record.modules ?? [],
        serverModules,
      );

      // --- 3. Upsert Resolution + related nodes ---
      const resolutionId =
        dedupResult.action === "upsert" && dedupResult.existingId
          ? dedupResult.existingId
          : uuidv4();

      await upsertResolutionGraph(
        resolutionId,
        record,
        teamId,
        userId,
        quality.tier,
        quality.confidence,
        moduleMappings,
      );

      // --- 4. Generate embeddings (batched: resolution + pattern in one API call) ---
      const embeddingText = [
        record.error_signature ?? "",
        record.root_cause ?? "",
        record.fix_approach ?? "",
        record.ticket_summary ?? "",
      ]
        .filter(Boolean)
        .join(" | ");

      let patternSignature: string | null = null;
      if (record.category === "bugfix" && record.error_signature) {
        patternSignature = record.error_signature;
      } else if (record.root_cause || record.ticket_summary) {
        patternSignature = record.root_cause ?? record.ticket_summary;
      }
      const needsPatternEmbedding =
        patternSignature != null && (record.root_cause || record.fix_approach);

      // Batch both texts into a single API call when both are needed
      const textsToEmbed: string[] = [];
      if (embeddingText.length > 0) textsToEmbed.push(embeddingText);
      if (needsPatternEmbedding) textsToEmbed.push(patternSignature!);

      let resolutionEmbedding: number[] | null = null;
      let patternEmbedding: number[] | null = null;

      if (textsToEmbed.length > 0) {
        const embeddings = await generateEmbeddings(textsToEmbed);
        let idx = 0;
        if (embeddingText.length > 0) resolutionEmbedding = embeddings[idx++];
        if (needsPatternEmbedding) patternEmbedding = embeddings[idx++];
      }

      if (resolutionEmbedding) {
        await runWrite(
          `MATCH (r:Resolution { id: $resId })
           SET r.embedding = $embedding`,
          { resId: resolutionId, embedding: resolutionEmbedding },
        );
      }

      // --- 7. Search for similar resolutions -> SIMILAR_TO edges ---
      await linkSimilarResolutions(resolutionId, record, teamId);

      // --- 8. Check/update patterns ---
      if (needsPatternEmbedding && patternEmbedding) {
        await createOrUpdatePattern({
          errorSignature: patternSignature!,
          teamId,
          rootCause: record.root_cause ?? record.ticket_summary ?? "",
          fixApproach: record.fix_approach ?? record.pr_diff_summary ?? "",
          category: record.category,
          files: (record.pr_files_changed ?? []).map((f) => f.path),
          embedding: patternEmbedding,
          resolutionId,
        });
      }

      result.ingested++;
      result.details.push({
        ticket_id: record.ticket_id,
        pr_url: record.pr_url,
        status: "ingested",
        resolution_id: resolutionId,
      });
    } catch (error) {
      result.errors++;
      const message =
        error instanceof Error ? error.message : String(error);
      result.details.push({
        ticket_id: record.ticket_id,
        pr_url: record.pr_url,
        status: "error",
        reason: message,
      });
    }
  }

  return result;
}
