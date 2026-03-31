// ---------------------------------------------------------------------------
// Module mapper — resolve file paths to team-owned modules
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamConfig {
  id: string;
  name: string;
  modules: {
    name: string;
    path_prefixes: string[];
    owner_team_id: string;
  }[];
}

export interface ModuleMapping {
  moduleName: string;
  teamId: string;
  files: string[];
  shared: boolean;
}

export interface LLMModule {
  name: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Match a single file path against the modules defined in a team config.
 * Returns the first matching module name + team, or undefined if no match.
 */
function matchModule(
  filePath: string,
  modules: TeamConfig["modules"],
): { moduleName: string; teamId: string } | undefined {
  for (const mod of modules) {
    for (const prefix of mod.path_prefixes) {
      if (filePath.startsWith(prefix)) {
        return { moduleName: mod.name, teamId: mod.owner_team_id };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map an array of file objects to modules using the team configuration
 * registry. Files that don't match any configured prefix are assigned to the
 * "unknown" module.
 */
export function mapFilesToModules(
  files: { path: string }[],
  teamConfig: TeamConfig,
): ModuleMapping[] {
  const mappings = new Map<
    string,
    { teamId: string; files: string[]; shared: boolean }
  >();

  for (const file of files) {
    const match = matchModule(file.path, teamConfig.modules);
    const moduleName = match?.moduleName ?? "unknown";
    const teamId = match?.teamId ?? teamConfig.id;

    const existing = mappings.get(moduleName);
    if (existing) {
      existing.files.push(file.path);
      // A module is shared if it is owned by a different team than the config
      if (existing.teamId !== teamId) {
        existing.shared = true;
      }
    } else {
      mappings.set(moduleName, {
        teamId,
        files: [file.path],
        shared: teamId !== teamConfig.id,
      });
    }
  }

  const result: ModuleMapping[] = [];
  for (const [moduleName, data] of mappings) {
    result.push({
      moduleName,
      teamId: data.teamId,
      files: data.files,
      shared: data.shared,
    });
  }

  return result;
}

/**
 * Validate LLM-assigned module classifications against the server-side module
 * mappings. Server mapping always wins for team assignment. If the LLM
 * identified a module that the server doesn't recognise, it is returned as a
 * suggested new module for review.
 */
export function validateLLMClassification(
  llmModules: LLMModule[],
  serverModules: ModuleMapping[],
): ModuleMapping[] {
  const serverModuleNames = new Set(serverModules.map((m) => m.moduleName));
  const result: ModuleMapping[] = [...serverModules];

  for (const llmMod of llmModules) {
    if (!serverModuleNames.has(llmMod.name)) {
      // LLM identified a module the server doesn't know about.
      // Return it as a suggested new module so it can be reviewed.
      console.warn(
        `[module-mapper] LLM suggested unknown module "${llmMod.name}" (confidence: ${llmMod.confidence}). Adding as suggested_new_module.`,
      );
      result.push({
        moduleName: llmMod.name,
        teamId: "suggested_new_module",
        files: [],
        shared: false,
      });
    }
  }

  return result;
}
