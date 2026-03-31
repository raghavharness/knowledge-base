import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import yaml from "js-yaml";
import { getDriver } from "../knowledge/graph.js";
import { signToken, type TokenResult } from "./jwt.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistrationInput {
  atlassian_id: string;
  email: string;
  name: string;
  projects: string[];
}

interface TeamMapping {
  [jiraProject: string]: string; // JIRA project key → team_id
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEAM_MAPPING_PATH = path.resolve(__dirname, "../../config/team-mapping.yaml");

interface TeamMappingEntry {
  jira_project: string;
  team_id: string;
}

/**
 * Load team-mapping.yaml and return a map of JIRA project key → team_id.
 */
function loadTeamMapping(): TeamMapping {
  const raw = fs.readFileSync(TEAM_MAPPING_PATH, "utf-8");
  const parsed = yaml.load(raw) as { team_mappings?: TeamMappingEntry[] };

  if (!parsed?.team_mappings || !Array.isArray(parsed.team_mappings)) {
    throw new Error("Invalid team-mapping.yaml: expected team_mappings array");
  }

  const mapping: TeamMapping = {};
  for (const entry of parsed.team_mappings) {
    mapping[entry.jira_project] = entry.team_id;
  }
  return mapping;
}

/**
 * Resolve JIRA project keys to team IDs using the mapping file.
 * Unknown projects are silently skipped.
 */
function resolveTeams(projects: string[]): string[] {
  const mapping = loadTeamMapping();
  const teams = new Set<string>();

  for (const project of projects) {
    const teamId = mapping[project];
    if (teamId) {
      teams.add(teamId);
    }
  }

  return [...teams];
}

/**
 * Validate that the email belongs to the allowed domain.
 */
function validateEmailDomain(email: string): void {
  const allowedDomain =
    process.env.ALLOWED_EMAIL_DOMAIN ?? "harness.io";
  const domain = email.split("@")[1]?.toLowerCase();

  if (!domain || domain !== allowedDomain.toLowerCase()) {
    throw new Error(
      `Email domain "${domain ?? ""}" is not allowed. Expected "@${allowedDomain}".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a new user via Atlassian identity, or return a fresh JWT if the
 * user already exists.
 *
 * Steps:
 *  1. Validate email domain against ALLOWED_EMAIL_DOMAIN.
 *  2. Map JIRA projects → team IDs via team-mapping.yaml.
 *  3. Check Neo4j for an existing user by atlassian_id.
 *     - If found → issue a fresh JWT for that user.
 *     - If not found → create User node + MEMBER_OF→Team relationships.
 *  4. Return the signed JWT.
 */
export interface RegistrationResult {
  token: string;
  userId: string;
  teams: string[];
}

export async function registerUser(
  input: RegistrationInput,
): Promise<RegistrationResult> {
  const { atlassian_id, email, name, projects } = input;

  // --- 1. Validate email domain ---
  validateEmailDomain(email);

  // --- 2. Resolve teams ---
  const teamIds = resolveTeams(projects);

  // --- 3. Check for existing user ---
  const driver = getDriver();
  const session = driver.session();

  try {
    // Look up by atlassian_id
    const existingResult = await session.run(
      `MATCH (u:User { atlassian_id: $atlassian_id })
       OPTIONAL MATCH (u)-[:MEMBER_OF]->(t:Team)
       RETURN u.id AS id, u.email AS email, collect(t.id) AS teams`,
      { atlassian_id },
    );

    if (existingResult.records.length > 0) {
      const record = existingResult.records[0];
      const userId = record.get("id") as string;
      const existingEmail = record.get("email") as string;
      const existingTeams = record.get("teams") as string[];

      const result = signToken({ userId, email: existingEmail, teams: existingTeams });
      return { token: result.token, userId, teams: existingTeams };
    }

    // --- 4. Create new user ---
    const userId = uuidv4();

    await session.run(
      `CREATE (u:User {
         id: $id,
         atlassian_id: $atlassian_id,
         email: $email,
         name: $name
       })
       WITH u
       UNWIND $teamIds AS teamId
       MERGE (t:Team { id: teamId })
       CREATE (u)-[:MEMBER_OF]->(t)`,
      { id: userId, atlassian_id, email, name, teamIds },
    );

    const result = signToken({ userId, email, teams: teamIds });
    return { token: result.token, userId, teams: teamIds };
  } finally {
    await session.close();
  }
}
