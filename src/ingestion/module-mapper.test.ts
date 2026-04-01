import { describe, it, expect } from "vitest";
import { mapFilesToModules, validateLLMClassification, type TeamConfig } from "./module-mapper.js";

const teamConfig: TeamConfig = {
  id: "team-ci",
  name: "CI Team",
  modules: [
    { name: "pipeline-service", path_prefixes: ["pipeline-service/", "src/pipeline/"], owner_team_id: "team-ci" },
    { name: "delegate", path_prefixes: ["delegate/"], owner_team_id: "team-platform" },
  ],
};

describe("mapFilesToModules", () => {
  it("maps files to known modules by prefix", () => {
    const result = mapFilesToModules(
      [{ path: "pipeline-service/src/main.go" }, { path: "pipeline-service/config.yaml" }],
      teamConfig,
    );
    expect(result).toHaveLength(1);
    expect(result[0].moduleName).toBe("pipeline-service");
    expect(result[0].files).toHaveLength(2);
  });

  it("assigns unmatched files to 'unknown'", () => {
    const result = mapFilesToModules([{ path: "random/file.txt" }], teamConfig);
    expect(result).toHaveLength(1);
    expect(result[0].moduleName).toBe("unknown");
  });

  it("marks cross-team modules as shared", () => {
    const result = mapFilesToModules([{ path: "delegate/runner.go" }], teamConfig);
    expect(result).toHaveLength(1);
    expect(result[0].moduleName).toBe("delegate");
    expect(result[0].shared).toBe(true);
    expect(result[0].teamId).toBe("team-platform");
  });

  it("handles empty file list", () => {
    expect(mapFilesToModules([], teamConfig)).toEqual([]);
  });

  it("groups multiple files into same module", () => {
    const result = mapFilesToModules(
      [{ path: "src/pipeline/a.ts" }, { path: "src/pipeline/b.ts" }],
      teamConfig,
    );
    expect(result).toHaveLength(1);
    expect(result[0].moduleName).toBe("pipeline-service");
    expect(result[0].files).toHaveLength(2);
  });
});

describe("validateLLMClassification", () => {
  it("preserves server modules", () => {
    const serverMods = mapFilesToModules([{ path: "pipeline-service/x.go" }], teamConfig);
    const result = validateLLMClassification([], serverMods);
    expect(result).toEqual(serverMods);
  });

  it("adds unknown LLM modules as suggested_new_module", () => {
    const serverMods = mapFilesToModules([{ path: "pipeline-service/x.go" }], teamConfig);
    const result = validateLLMClassification(
      [{ name: "new-thing", confidence: 0.8 }],
      serverMods,
    );
    expect(result).toHaveLength(2);
    expect(result[1].moduleName).toBe("new-thing");
    expect(result[1].teamId).toBe("suggested_new_module");
  });

  it("does not duplicate modules the server already knows", () => {
    const serverMods = mapFilesToModules([{ path: "pipeline-service/x.go" }], teamConfig);
    const result = validateLLMClassification(
      [{ name: "pipeline-service", confidence: 0.9 }],
      serverMods,
    );
    expect(result).toHaveLength(1);
  });
});
