import { runQuery } from "../knowledge/graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DedupResult {
  isDuplicate: boolean;
  existingId?: string;
  action: "upsert" | "create";
  reason?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a record is a duplicate of an existing Resolution in the graph.
 *
 * Logic:
 *  1. If ticket_id is provided, look for an existing Ticket node linked to a
 *     Resolution. If that Resolution was agent-resolved -> skip. If ingested
 *     and the new data is richer -> merge. Otherwise -> skip.
 *  2. If pr_url is provided, same logic against existing PR nodes.
 *  3. Neither exists -> create.
 */
export async function checkDuplicate(params: {
  ticketId?: string;
  prUrl?: string;
  teamId: string;
}): Promise<DedupResult> {
  const { ticketId, prUrl, teamId } = params;

  // --- Check by ticket_id ---
  if (ticketId) {
    const ticketRecords = await runQuery(
      `MATCH (t:Ticket { ticket_id: $ticketId })<-[:HAS_TICKET]-(r:Resolution)-[:SCOPED_TO]->(team:Team { id: $teamId })
       RETURN r.id AS id, r.source AS source ORDER BY toString(r.created_at) DESC LIMIT 1`,
      { ticketId, teamId },
    );

    if (ticketRecords.length > 0) {
      const record = ticketRecords[0];
      const existingId = record.get("id") as string;

      return {
        isDuplicate: true,
        existingId,
        action: "upsert",
        reason: `Ticket ${ticketId} exists; upserting with latest data`,
      };
    }
  }

  // --- Check by pr_url ---
  if (prUrl) {
    const prRecords = await runQuery(
      `MATCH (p:PR { url: $prUrl })<-[:HAS_PR]-(r:Resolution)-[:SCOPED_TO]->(team:Team { id: $teamId })
       RETURN r.id AS id, r.source AS source ORDER BY r.created_at DESC LIMIT 1`,
      { prUrl, teamId },
    );

    if (prRecords.length > 0) {
      const record = prRecords[0];
      const existingId = record.get("id") as string;

      return {
        isDuplicate: true,
        existingId,
        action: "upsert",
        reason: `PR ${prUrl} exists; upserting with latest data`,
      };
    }
  }

  // --- Neither exists ---
  return {
    isDuplicate: false,
    action: "create",
  };
}
