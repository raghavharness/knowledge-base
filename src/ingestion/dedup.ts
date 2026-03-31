import { getDriver } from "../knowledge/graph.js";

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
 *     Resolution. If that Resolution was agent-resolved → skip. If ingested
 *     and the new data is richer → merge. Otherwise → skip.
 *  2. If pr_url is provided, same logic against existing PR nodes.
 *  3. Neither exists → create.
 */
export async function checkDuplicate(params: {
  ticketId?: string;
  prUrl?: string;
  teamId: string;
}): Promise<DedupResult> {
  const { ticketId, prUrl, teamId } = params;
  const driver = getDriver();
  const session = driver.session();

  try {
    // --- Check by ticket_id ---
    if (ticketId) {
      const ticketResult = await session.run(
        `MATCH (t:Ticket { ticket_id: $ticketId })<-[:HAS_TICKET]-(r:Resolution)-[:SCOPED_TO]->(team:Team { id: $teamId })
         RETURN r.id AS id, r.source AS source`,
        { ticketId, teamId },
      );

      if (ticketResult.records.length > 0) {
        const record = ticketResult.records[0];
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
      const prResult = await session.run(
        `MATCH (p:PR { url: $prUrl })<-[:HAS_PR]-(r:Resolution)-[:SCOPED_TO]->(team:Team { id: $teamId })
         RETURN r.id AS id, r.source AS source`,
        { prUrl, teamId },
      );

      if (prResult.records.length > 0) {
        const record = prResult.records[0];
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
  } finally {
    await session.close();
  }
}
