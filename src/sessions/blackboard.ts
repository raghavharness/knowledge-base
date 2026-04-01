import { runQuery, runWrite } from "../knowledge/graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  team_id: string;
  user_id: string;
  input?: string;
  current_phase: string;
  findings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse a JSON string into a Record, returning an empty object on
 * failure.
 */
function parseFindings(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Convert a Neo4j record into a Session object.
 */
function recordToSession(props: Record<string, unknown>): Session {
  return {
    id: props.id as string,
    team_id: props.team_id as string,
    user_id: props.user_id as string,
    input: (props.input as string | undefined) ?? undefined,
    current_phase: props.current_phase as string,
    findings: parseFindings(props.findings),
    created_at: props.created_at as string,
    updated_at: props.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve an existing session by ID and team.
 * Returns null if the session does not exist.
 */
export async function getSession(
  sessionId: string,
  teamId: string,
): Promise<Session | null> {
  const records = await runQuery(
    `MATCH (s:Session { id: $sessionId, team_id: $teamId })
     RETURN properties(s) AS props`,
    { sessionId, teamId },
  );

  if (records.length === 0) {
    return null;
  }

  const props = records[0].get("props") as Record<string, unknown>;
  return recordToSession(props);
}

/**
 * Create or update a session in the knowledge graph.
 *
 * - If the session already exists: merges new findings into existing findings,
 *   updates the phase and updated_at timestamp.
 * - If the session is new: creates a Session node with all provided properties.
 */
export async function upsertSession(params: {
  sessionId: string;
  teamId: string;
  userId: string;
  input?: string;
  phase?: string;
  findings?: Record<string, unknown>;
}): Promise<Session> {
  const { sessionId, teamId, userId, input, phase, findings } = params;
  const now = new Date().toISOString();

  // Check for existing session
  const existing = await runQuery(
    `MATCH (s:Session { id: $sessionId })
     RETURN properties(s) AS props`,
    { sessionId },
  );

  if (existing.length > 0) {
    // --- Update existing session ---
    const existingProps = existing[0].get("props") as Record<string, unknown>;
    const existingFindings = parseFindings(existingProps.findings);
    const mergedFindings = { ...existingFindings, ...findings };

    const updateResult = await runWrite(
      `MATCH (s:Session { id: $sessionId })
       SET s.current_phase = COALESCE($phase, s.current_phase),
           s.findings = $findings,
           s.updated_at = $now
       RETURN properties(s) AS props`,
      {
        sessionId,
        phase: phase ?? null,
        findings: JSON.stringify(mergedFindings),
        now,
      },
    );

    const updatedProps = updateResult[0].get("props") as Record<string, unknown>;
    return recordToSession(updatedProps);
  }

  // --- Create new session ---
  const createResult = await runWrite(
    `CREATE (s:Session {
       id: $sessionId,
       team_id: $teamId,
       user_id: $userId,
       input: $input,
       current_phase: $phase,
       findings: $findings,
       created_at: $now,
       updated_at: $now
     })
     RETURN properties(s) AS props`,
    {
      sessionId,
      teamId,
      userId,
      input: input ?? null,
      phase: phase ?? "init",
      findings: JSON.stringify(findings ?? {}),
      now,
    },
  );

  const createdProps = createResult[0].get("props") as Record<string, unknown>;
  return recordToSession(createdProps);
}

/**
 * Remove sessions whose updated_at timestamp is older than 24 hours.
 * Returns the number of deleted sessions.
 */
export async function cleanExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const records = await runWrite(
    `MATCH (s:Session)
     WHERE s.updated_at < $cutoff
     WITH s, s.id AS sid
     DETACH DELETE s
     RETURN count(sid) AS deleted`,
    { cutoff },
  );

  const deleted = records[0].get("deleted");
  return typeof deleted === "object" && deleted !== null && "toNumber" in deleted
    ? (deleted as { toNumber(): number }).toNumber()
    : (deleted as number);
}
