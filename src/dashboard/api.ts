import { Router } from "express";
import { runQuery } from "../knowledge/graph.js";
import neo4j from "neo4j-driver";

const router = Router();

/** Convert Neo4j Integer to plain number */
function toNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (neo4j.isInt(val)) return (val as neo4j.Integer).toNumber();
  if (typeof val === "number") return val;
  return 0;
}

/** Convert Neo4j temporal to ISO string */
function toDate(val: unknown): string | null {
  if (!val) return null;
  return String(val);
}

/** Safely extract a scalar from a Neo4j record */
function str(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

// ── GET /api/teams ──
router.get("/teams", async (_req, res) => {
  try {
    const records = await runQuery(`
      MATCH (t:Team)
      RETURN t.id AS id, t.name AS name
      ORDER BY t.name
    `);
    res.json(records.map((r) => ({ id: str(r.get("id")), name: str(r.get("name")) })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/stats?team= ──
router.get("/stats", async (req, res) => {
  const team = req.query.team as string | undefined;
  const teamFilter = team ? "WHERE r_team.id = $team" : "";
  const teamParam = team ? { team } : {};

  try {
    const [counts, categories, tiers, recent] = await Promise.all([
      runQuery(
        `
        MATCH (r:Resolution)-[:SCOPED_TO]->(r_team:Team) ${teamFilter}
        WITH count(r) AS resolutions
        OPTIONAL MATCH (p:Pattern) ${team ? "WHERE p.team_id = $team" : ""}
        WITH resolutions, count(p) AS patterns
        RETURN resolutions, patterns
        `,
        teamParam,
      ),
      runQuery(
        `
        MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team)
        WHERE r.category IS NOT NULL ${team ? "AND t.id = $team" : ""}
        RETURN r.category AS category, count(*) AS count
        ORDER BY count DESC
        `,
        teamParam,
      ),
      runQuery(
        `
        MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team)
        WHERE r.quality_tier IS NOT NULL ${team ? "AND t.id = $team" : ""}
        RETURN r.quality_tier AS tier, count(*) AS count
        ORDER BY tier
        `,
        teamParam,
      ),
      runQuery(
        `
        MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team) ${team ? "WHERE t.id = $team" : ""}
        OPTIONAL MATCH (r)-[:HAS_ERROR]->(e:Error)
        OPTIONAL MATCH (r)-[:HAS_TICKET]->(tk:Ticket)
        OPTIONAL MATCH (r)-[:HAS_FIX]->(f:Fix)
        OPTIONAL MATCH (r)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
        RETURN r.id AS id, r.category AS category, r.quality_tier AS tier,
               r.created_at AS created_at, e.signature AS error,
               tk.ticket_id AS ticket_id, COALESCE(tk.summary, r.summary) AS summary,
               f.approach AS fix, rc.description AS root_cause
        ORDER BY toString(r.created_at) DESC
        LIMIT 20
        `,
        teamParam,
      ),
    ]);

    // Count errors, modules, files, repos for this team
    const [extraCounts] = await Promise.all([
      runQuery(
        `
        MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team) ${team ? "WHERE t.id = $team" : ""}
        OPTIONAL MATCH (r)-[:HAS_ERROR]->(e:Error)
        OPTIONAL MATCH (r)-[:AFFECTS_MODULE]->(m:Module)
        OPTIONAL MATCH (r)-[:CHANGED_FILE]->(f:File)
        OPTIONAL MATCH (r)-[:HAS_PR]->(p:PR)
        RETURN count(DISTINCT e) AS errors, count(DISTINCT m) AS modules,
               count(DISTINCT f) AS files, count(DISTINCT p.repo) AS repos
        `,
        teamParam,
      ),
    ]);

    const c = counts[0];
    const ec = extraCounts[0];
    res.json({
      counts: {
        resolutions: c ? toNum(c.get("resolutions")) : 0,
        patterns: c ? toNum(c.get("patterns")) : 0,
        errors: ec ? toNum(ec.get("errors")) : 0,
        modules: ec ? toNum(ec.get("modules")) : 0,
        files: ec ? toNum(ec.get("files")) : 0,
        repos: ec ? toNum(ec.get("repos")) : 0,
      },
      categories: categories.map((r) => ({
        category: str(r.get("category")),
        count: toNum(r.get("count")),
      })),
      tiers: tiers.map((r) => ({
        tier: toNum(r.get("tier")),
        count: toNum(r.get("count")),
      })),
      recent: recent.map((r) => ({
        id: str(r.get("id")),
        category: str(r.get("category")),
        tier: toNum(r.get("tier")),
        created_at: toDate(r.get("created_at")),
        error: str(r.get("error")),
        ticket_id: str(r.get("ticket_id")),
        summary: str(r.get("summary")),
        fix: str(r.get("fix")),
        root_cause: str(r.get("root_cause")),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/resolutions?team=&page=&limit=&category=&tier=&search= ──
router.get("/resolutions", async (req, res) => {
  const team = req.query.team as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;
  const category = req.query.category as string | undefined;
  const tier = req.query.tier as string | undefined;
  const search = req.query.search as string | undefined;

  // Sorting — whitelist allowed fields to prevent injection
  // created_at uses toString() because some records store DateTime objects
  // and others store strings — Neo4j sorts different types separately,
  // so we normalize to string for consistent lexicographic comparison.
  const allowedSortFields: Record<string, string> = {
    created_at: "toString(r.created_at)",
    category: "r.category",
    tier: "r.quality_tier",
    ticket_id: "tk.ticket_id",
    confidence: "r.confidence",
  };
  const sortField = allowedSortFields[req.query.sort as string] ?? "r.created_at";
  const sortOrder = (req.query.order as string)?.toUpperCase() === "ASC" ? "ASC" : "DESC";

  let where = team ? "WHERE t.id = $team" : "";
  if (category) where += (where ? " AND " : "WHERE ") + "r.category = $category";
  if (tier) where += (where ? " AND " : "WHERE ") + "r.quality_tier = toInteger($tier)";

  const params: Record<string, unknown> = { skip: neo4j.int(skip), limit: neo4j.int(limit) };
  if (team) params.team = team;
  if (category) params.category = category;
  if (tier) params.tier = tier;

  let searchClause = "";
  if (search) {
    const trimmed = search.trim();
    // Looks like a JIRA ticket ID or prefix (e.g. "CI-", "CI-217", "CI-21740")
    const isTicketPattern = /^[A-Z]+-\d*$/i.test(trimmed);
    if (isTicketPattern) {
      searchClause = `WHERE toUpper(tk.ticket_id) STARTS WITH toUpper($search)`;
    } else {
      searchClause = `WHERE (
        toLower(tk.ticket_id) CONTAINS toLower($search) OR
        toLower(tk.summary) CONTAINS toLower($search) OR
        toLower(e.signature) CONTAINS toLower($search) OR
        toLower(rc.description) CONTAINS toLower($search)
      )`;
    }
    params.search = trimmed;
  }

  try {
    const [records, countResult] = await Promise.all([
      runQuery(
        `
        MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team) ${where}
        OPTIONAL MATCH (r)-[:HAS_ERROR]->(e:Error)
        WITH r, t, head(collect(e)) AS e
        OPTIONAL MATCH (r)-[:HAS_TICKET]->(tk:Ticket)
        WITH r, t, e, head(collect(tk)) AS tk
        OPTIONAL MATCH (r)-[:HAS_FIX]->(f:Fix)
        WITH r, t, e, tk, head(collect(f)) AS f
        OPTIONAL MATCH (r)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
        WITH r, t, e, tk, f, head(collect(rc)) AS rc
        OPTIONAL MATCH (r)-[:HAS_PR]->(p:PR)
        WITH r, t, e, tk, f, rc, head(collect(p)) AS p
        ${search ? searchClause : ""}
        RETURN r.id AS id, r.category AS category, r.quality_tier AS tier,
               r.created_at AS created_at, r.confidence AS confidence,
               e.signature AS error, tk.ticket_id AS ticket_id,
               COALESCE(tk.summary, r.summary) AS summary, tk.type AS ticket_type,
               tk.priority AS ticket_priority, COALESCE(tk.assignee, p.author) AS assignee,
               f.approach AS fix,
               rc.description AS root_cause, p.url AS pr_url,
               COALESCE(p.title, r.summary) AS pr_title, p.repo AS pr_repo,
               p.author AS pr_author, p.merged_at AS pr_merged_at
        ORDER BY ${sortField} ${sortOrder}
        SKIP $skip LIMIT $limit
        `,
        params,
      ),
      runQuery(
        `
        MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team) ${where}
        OPTIONAL MATCH (r)-[:HAS_TICKET]->(tk:Ticket)
        WITH r, t, head(collect(tk)) AS tk
        ${search ? (
          /^[A-Z]+-\d*$/i.test((search || "").trim())
            ? `WHERE toUpper(tk.ticket_id) STARTS WITH toUpper($search)`
            : `OPTIONAL MATCH (r)-[:HAS_ERROR]->(e:Error)
               WITH r, t, tk, head(collect(e)) AS e
               OPTIONAL MATCH (r)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
               WITH r, t, tk, e, head(collect(rc)) AS rc
               WHERE (
                 toLower(tk.ticket_id) CONTAINS toLower($search) OR
                 toLower(tk.summary) CONTAINS toLower($search) OR
                 toLower(e.signature) CONTAINS toLower($search) OR
                 toLower(rc.description) CONTAINS toLower($search)
               )`
          ) : ""}
        RETURN count(r) AS total
        `,
        params,
      ),
    ]);

    res.json({
      data: records.map((r) => ({
        id: str(r.get("id")),
        category: str(r.get("category")),
        tier: toNum(r.get("tier")),
        created_at: toDate(r.get("created_at")),
        confidence: r.get("confidence"),
        error: str(r.get("error")),
        ticket_id: str(r.get("ticket_id")),
        summary: str(r.get("summary")),
        ticket_type: str(r.get("ticket_type")),
        ticket_priority: str(r.get("ticket_priority")),
        assignee: str(r.get("assignee")),
        fix: str(r.get("fix")),
        root_cause: str(r.get("root_cause")),
        pr_url: str(r.get("pr_url")),
        pr_title: str(r.get("pr_title")),
        pr_repo: str(r.get("pr_repo")),
        pr_author: str(r.get("pr_author")),
        pr_merged_at: toDate(r.get("pr_merged_at")),
      })),
      total: countResult[0] ? toNum(countResult[0].get("total")) : 0,
      page,
      limit,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/resolutions/:id ──
router.get("/resolutions/:id", async (req, res) => {
  try {
    const records = await runQuery(
      `
      MATCH (r:Resolution {id: $id})
      OPTIONAL MATCH (r)-[:SCOPED_TO]->(t:Team)
      OPTIONAL MATCH (r)-[:HAS_ERROR]->(e:Error)
      OPTIONAL MATCH (r)-[:HAS_TICKET]->(tk:Ticket)
      OPTIONAL MATCH (r)-[:HAS_FIX]->(f:Fix)
      OPTIONAL MATCH (r)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
      OPTIONAL MATCH (r)-[:HAS_PR]->(p:PR)
      OPTIONAL MATCH (r)-[:CHANGED_FILE]->(file:File)
      OPTIONAL MATCH (r)-[:AFFECTS_MODULE]->(m:Module)
      OPTIONAL MATCH (r)-[:SIMILAR_TO]->(sim:Resolution)
      WITH r, t, head(collect(DISTINCT e)) AS e, head(collect(DISTINCT tk)) AS tk,
           head(collect(DISTINCT f)) AS f, head(collect(DISTINCT rc)) AS rc,
           collect(DISTINCT p {.url, .title, .repo, .state, .diff_summary, .author,
                                .reviewers, .merged_at, .pr_created_at, .description,
                                .comments_summary, .additions, .deletions, .review_decision}) AS prs,
           collect(DISTINCT file.path) AS files_changed,
           collect(DISTINCT m.name) AS modules,
           collect(DISTINCT sim.id) AS similar_ids
      RETURN r.id AS id, r.summary AS summary, r.category AS category, r.quality_tier AS tier,
             r.confidence AS confidence, r.search_weight AS search_weight,
             r.created_at AS created_at, r.ingested_by AS ingested_by,
             r.source AS source,
             t.id AS team_id, t.name AS team_name,
             e.signature AS error_signature,
             tk.ticket_id AS ticket_id, COALESCE(tk.summary, r.summary) AS ticket_summary,
             tk.status AS ticket_status, tk.resolution AS ticket_resolution,
             tk.type AS ticket_type, tk.priority AS ticket_priority,
             tk.assignee AS ticket_assignee, tk.reporter AS ticket_reporter,
             tk.ticket_created_at AS ticket_created_at, tk.resolved_at AS ticket_resolved_at,
             tk.labels AS ticket_labels, tk.components AS ticket_components,
             tk.description AS ticket_description, tk.conclusion AS ticket_conclusion,
             tk.comments_summary AS ticket_comments_summary,
             tk.feature_flag AS ticket_feature_flag, tk.sprint AS ticket_sprint,
             f.approach AS fix_approach,
             rc.description AS root_cause,
             prs,
             files_changed,
             modules,
             similar_ids
      `,
      { id: req.params.id },
    );

    if (!records.length) {
      res.status(404).json({ error: "Resolution not found" });
      return;
    }

    const r = records[0];
    const rawPrs = (r.get("prs") as Record<string, unknown>[] | null) ?? [];
    const prs = rawPrs
      .filter((p) => p.url || p.title || p.repo)
      .map((p) => ({
        url: p.url != null ? String(p.url) : null,
        title: p.title != null ? String(p.title) : null,
        repo: p.repo != null ? String(p.repo) : null,
        state: p.state != null ? String(p.state) : null,
        diff_summary: p.diff_summary != null ? String(p.diff_summary) : null,
        author: p.author != null ? String(p.author) : null,
        reviewers: (p.reviewers as string[] | null) ?? [],
        merged_at: p.merged_at != null ? String(p.merged_at) : null,
        created_at: p.pr_created_at != null ? String(p.pr_created_at) : null,
        description: p.description != null ? String(p.description) : null,
        comments_summary: p.comments_summary != null ? String(p.comments_summary) : null,
        additions: p.additions != null ? toNum(p.additions) : null,
        deletions: p.deletions != null ? toNum(p.deletions) : null,
        review_decision: p.review_decision != null ? String(p.review_decision) : null,
      }));

    res.json({
      id: str(r.get("id")),
      summary: str(r.get("summary")),
      category: str(r.get("category")),
      tier: toNum(r.get("tier")),
      confidence: r.get("confidence"),
      search_weight: r.get("search_weight"),
      created_at: toDate(r.get("created_at")),
      ingested_by: str(r.get("ingested_by")),
      source: str(r.get("source")),
      team: { id: str(r.get("team_id")), name: str(r.get("team_name")) },
      error_signature: str(r.get("error_signature")),
      ticket: {
        id: str(r.get("ticket_id")),
        summary: str(r.get("ticket_summary")),
        status: str(r.get("ticket_status")),
        resolution: str(r.get("ticket_resolution")),
        type: str(r.get("ticket_type")),
        priority: str(r.get("ticket_priority")),
        assignee: str(r.get("ticket_assignee")) ?? prs.find(p => p.author)?.author ?? null,
        reporter: str(r.get("ticket_reporter")),
        created_at: str(r.get("ticket_created_at")),
        resolved_at: str(r.get("ticket_resolved_at")),
        labels: (r.get("ticket_labels") as string[] | null) ?? [],
        components: (r.get("ticket_components") as string[] | null) ?? [],
        description: str(r.get("ticket_description")),
        conclusion: str(r.get("ticket_conclusion")),
        comments_summary: str(r.get("ticket_comments_summary")),
        feature_flag: str(r.get("ticket_feature_flag")),
        sprint: str(r.get("ticket_sprint")),
      },
      fix_approach: str(r.get("fix_approach")),
      root_cause: str(r.get("root_cause")),
      prs,
      files_changed: (r.get("files_changed") as string[]).filter(Boolean),
      modules: (r.get("modules") as string[]).filter(Boolean),
      similar_ids: (r.get("similar_ids") as string[]).filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/repos?team= ──
router.get("/repos", async (req, res) => {
  const team = req.query.team as string | undefined;
  const params: Record<string, unknown> = {};
  const teamFilter = team ? "WHERE t.id = $team" : "";
  if (team) params.team = team;

  try {
    const records = await runQuery(
      `
      MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team) ${teamFilter}
      MATCH (r)-[:HAS_PR]->(p:PR)
      WHERE p.repo IS NOT NULL
      WITH p.repo AS repo, t.name AS team_name,
           count(r) AS resolution_count,
           collect(DISTINCT r.category) AS categories
      RETURN repo, team_name, resolution_count, categories
      ORDER BY resolution_count DESC
      `,
      params,
    );

    res.json(
      records.map((r) => ({
        repo: str(r.get("repo")),
        team: str(r.get("team_name")),
        resolution_count: toNum(r.get("resolution_count")),
        categories: r.get("categories"),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/repos/:repo?team= ──
router.get("/repos/:repo", async (req, res) => {
  const repo = req.params.repo;
  const team = req.query.team as string | undefined;
  const params: Record<string, unknown> = { repo };
  const teamFilter = team ? "AND t.id = $team" : "";
  if (team) params.team = team;

  try {
    const records = await runQuery(
      `
      MATCH (r:Resolution)-[:HAS_PR]->(p:PR {repo: $repo})
      MATCH (r)-[:SCOPED_TO]->(t:Team) ${teamFilter ? teamFilter : ""}
      OPTIONAL MATCH (r)-[:HAS_ERROR]->(e:Error)
      OPTIONAL MATCH (r)-[:HAS_TICKET]->(tk:Ticket)
      OPTIONAL MATCH (r)-[:CHANGED_FILE]->(f:File)
      WITH r, e, tk,
           collect(DISTINCT p.title)[0] AS pr_title,
           collect(DISTINCT p.url)[0] AS pr_url,
           collect(DISTINCT f.path) AS files
      RETURN DISTINCT r.id AS id, r.category AS category, r.quality_tier AS tier,
             r.created_at AS created_at, e.signature AS error,
             tk.ticket_id AS ticket_id, tk.summary AS summary,
             pr_title, pr_url, files
      ORDER BY toString(r.created_at) DESC
      `,
      params,
    );

    res.json(
      records.map((r) => ({
        id: str(r.get("id")),
        category: str(r.get("category")),
        tier: toNum(r.get("tier")),
        created_at: toDate(r.get("created_at")),
        error: str(r.get("error")),
        ticket_id: str(r.get("ticket_id")),
        summary: str(r.get("summary")),
        pr_title: str(r.get("pr_title")),
        pr_url: str(r.get("pr_url")),
        files: (r.get("files") as string[]).filter(Boolean),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/patterns?team=&sort=&order= ──
router.get("/patterns", async (req, res) => {
  const team = req.query.team as string | undefined;
  const sort = (req.query.sort as string) || "occurrences";
  const order = (req.query.order as string) === "asc" ? "ASC" : "DESC";
  const params: Record<string, unknown> = {};
  const teamFilter = team ? "{team_id: $team}" : "";
  if (team) params.team = team;

  const sortField = sort === "success_rate" ? "p.success_rate" : "p.occurrences";

  try {
    // 1. Get patterns with files
    const records = await runQuery(
      `
      MATCH (p:Pattern ${teamFilter})
      OPTIONAL MATCH (p)-[:PATTERN_FILE]->(f:File)
      WITH p, collect(DISTINCT f.path) AS files
      RETURN
        p.id AS id,
        p.error_signature AS error_signature,
        p.root_cause AS root_cause,
        p.fix_approach AS fix_approach,
        p.category AS category,
        p.occurrences AS occurrences,
        p.success_rate AS success_rate,
        p.team_id AS team_id,
        files
      ORDER BY ${sortField} ${order}
      `,
      params,
    );

    // 2. Get linked resolutions per pattern (deduplicated, max 10 per pattern)
    const patternIds = records.map((r) => str(r.get("id"))).filter(Boolean) as string[];
    const resMap = new Map<string, {
      id: string | null; category: string | null; created_at: string | null;
      ticket_id: string | null; summary: string | null;
      pr_url: string | null; pr_repo: string | null; pr_title: string | null;
      pr_author: string | null;
    }[]>();

    if (patternIds.length > 0) {
      const relRecords = await runQuery(
        `
        UNWIND $patternIds AS pid
        MATCH (r:Resolution)-[:MATCHED_PATTERN]->(p:Pattern {id: pid})
        WITH pid, r
        ORDER BY toString(r.created_at) DESC
        WITH pid, collect(DISTINCT r)[0..10] AS resolutions
        UNWIND resolutions AS r
        OPTIONAL MATCH (r)-[:HAS_TICKET]->(tk:Ticket)
        OPTIONAL MATCH (r)-[:HAS_PR]->(pr:PR)
        WITH pid, r, head(collect(tk)) AS tk, head(collect(pr)) AS pr
        RETURN pid AS pattern_id,
               r.id AS res_id, r.category AS category, r.created_at AS created_at,
               tk.ticket_id AS ticket_id, tk.summary AS summary,
               pr.url AS pr_url, pr.repo AS pr_repo, pr.title AS pr_title,
               pr.author AS pr_author
        `,
        { patternIds },
      );

      for (const r of relRecords) {
        const pid = str(r.get("pattern_id")) ?? "";
        if (!resMap.has(pid)) resMap.set(pid, []);
        resMap.get(pid)!.push({
          id: str(r.get("res_id")),
          category: str(r.get("category")),
          created_at: toDate(r.get("created_at")),
          ticket_id: str(r.get("ticket_id")),
          summary: str(r.get("summary")),
          pr_url: str(r.get("pr_url")),
          pr_repo: str(r.get("pr_repo")),
          pr_title: str(r.get("pr_title")),
          pr_author: str(r.get("pr_author")),
        });
      }
    }

    const patterns = records.map((r) => {
      const pid = str(r.get("id")) ?? "";
      return {
        id: pid,
        error_signature: str(r.get("error_signature")),
        root_cause: str(r.get("root_cause")),
        fix_approach: str(r.get("fix_approach")),
        category: str(r.get("category")) ?? "bugfix",
        occurrences: toNum(r.get("occurrences")),
        success_rate: r.get("success_rate"),
        team_id: str(r.get("team_id")),
        files: (r.get("files") as string[]).filter(Boolean),
        resolutions: resMap.get(pid) ?? [],
      };
    });

    res.json(patterns);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/insights?team=&page=&limit= ──
router.get("/insights", async (req, res) => {
  const team = req.query.team as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  const skip = (page - 1) * limit;
  const params: Record<string, unknown> = { skip: neo4j.int(skip), limit: neo4j.int(limit) };
  const teamFilter = team ? "AND t.id = $team" : "";
  if (team) params.team = team;

  try {
    const [records, countResult] = await Promise.all([
      runQuery(
        `
        MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team)
        WHERE r.source = 'agent' ${teamFilter}
        OPTIONAL MATCH (r)-[:CREATED_BY]->(u:User)
        WITH r, t, head(collect(u)) AS u
        OPTIONAL MATCH (r)-[:HAS_ERROR]->(e:Error)
        WITH r, t, u, head(collect(e)) AS e
        OPTIONAL MATCH (r)-[:HAS_TICKET]->(tk0:Ticket)
        WITH r, t, u, e, head(collect(tk0)) AS tk
        OPTIONAL MATCH (r)-[:HAS_ROOT_CAUSE]->(rc:RootCause)
        WITH r, t, u, e, tk, head(collect(rc)) AS rc
        OPTIONAL MATCH (r)-[:HAS_FIX]->(f:Fix)
        WITH r, t, u, e, tk, rc, head(collect(f)) AS f
        OPTIONAL MATCH (r)-[:HAS_PR]->(p:PR)
        WITH r, t, u, e, tk, rc, f, head(collect(p)) AS p
        OPTIONAL MATCH (r)-[:SIMILAR_TO]->(sim:Resolution)
        WITH r, t, u, e, tk, rc, f, p, count(sim) AS similar_count
        OPTIONAL MATCH (r)-[:MATCHED_PATTERN]->(pat:Pattern)
        WITH r, t, u, e, tk, rc, f, p, similar_count, head(collect(pat)) AS pat
        RETURN r.id AS id,
               r.resolution_type AS resolution_type,
               r.created_at AS created_at,
               r.investigation_path AS investigation_path,
               r.effective_step AS effective_step,
               r.time_to_root_cause_minutes AS time_to_root_cause,
               r.ci_attempts AS ci_attempts,
               r.input_type AS input_type,
               u.name AS user_name, u.email AS user_email,
               t.id AS team_id, t.name AS team_name,
               e.signature AS error_signature,
               tk.ticket_id AS ticket_id,
               tk.summary AS ticket_summary,
               rc.description AS root_cause,
               f.approach AS fix_approach,
               p.url AS pr_url, p.title AS pr_title,
               p.repo AS pr_repo, p.author AS pr_author,
               similar_count,
               pat.error_signature AS matched_pattern,
               r.knowledge_used AS knowledge_used
        ORDER BY toString(r.created_at) DESC
        SKIP $skip LIMIT $limit
        `,
        params,
      ),
      runQuery(
        `
        MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team)
        WHERE r.source = 'agent' ${teamFilter}
        RETURN count(r) AS total
        `,
        params,
      ),
    ]);

    res.json({
      data: records.map((r) => ({
        id: str(r.get("id")),
        resolution_type: str(r.get("resolution_type")),
        created_at: toDate(r.get("created_at")),
        investigation_path: (r.get("investigation_path") as string[] | null) ?? [],
        effective_step: str(r.get("effective_step")),
        time_to_root_cause: r.get("time_to_root_cause") != null ? toNum(r.get("time_to_root_cause")) : null,
        ci_attempts: r.get("ci_attempts") != null ? toNum(r.get("ci_attempts")) : null,
        input_type: str(r.get("input_type")),
        user: { name: str(r.get("user_name")), email: str(r.get("user_email")) },
        team: { id: str(r.get("team_id")), name: str(r.get("team_name")) },
        error_signature: str(r.get("error_signature")),
        ticket_id: str(r.get("ticket_id")),
        ticket_summary: str(r.get("ticket_summary")),
        root_cause: str(r.get("root_cause")),
        fix_approach: str(r.get("fix_approach")),
        pr_url: str(r.get("pr_url")),
        pr_title: str(r.get("pr_title")),
        pr_repo: str(r.get("pr_repo")),
        pr_author: str(r.get("pr_author")),
        similar_count: toNum(r.get("similar_count")),
        matched_pattern: str(r.get("matched_pattern")),
        knowledge_used: (() => {
          const raw = r.get("knowledge_used");
          if (!raw) return [];
          try { return JSON.parse(String(raw)); } catch { return []; }
        })(),
      })),
      total: countResult[0] ? toNum(countResult[0].get("total")) : 0,
      page,
      limit,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/timeline?team=&days= ──
router.get("/timeline", async (req, res) => {
  const team = req.query.team as string | undefined;
  const days = Math.min(365, Math.max(7, parseInt(req.query.days as string) || 30));
  const params: Record<string, unknown> = { days: neo4j.int(days) };
  const teamFilter = team ? "AND t.id = $team" : "";
  if (team) params.team = team;

  try {
    const cypher = team
      ? `
      MATCH (r:Resolution)-[:SCOPED_TO]->(t:Team)
      WHERE r.created_at IS NOT NULL AND t.id = $team
      WITH r, date(datetime(r.created_at)) AS day
      WHERE day >= date() - duration({days: $days})
      RETURN toString(day) AS date, r.category AS category, count(*) AS cnt
      ORDER BY date
      `
      : `
      MATCH (r:Resolution)
      WHERE r.created_at IS NOT NULL
      WITH r, date(datetime(r.created_at)) AS day
      WHERE day >= date() - duration({days: $days})
      RETURN toString(day) AS date, r.category AS category, count(*) AS cnt
      ORDER BY date
      `;
    const records = await runQuery(cypher, params);

    res.json(
      records.map((r) => ({
        date: str(r.get("date")),
        category: str(r.get("category")),
        count: toNum(r.get("cnt")),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export { router as dashboardApi };
