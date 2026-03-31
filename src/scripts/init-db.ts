import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { runWrite, closeDriver } from "../knowledge/graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function initializeDatabase() {
  console.log("Initializing Neo4j schema...");

  const schemaPath = resolve(__dirname, "../../cypher/schema.cypher");
  const schema = readFileSync(schemaPath, "utf-8");

  // Split by semicolons, strip comment lines, then execute each statement
  const statements = schema
    .split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    try {
      await runWrite(statement + ";");
      console.log(`  OK: ${statement.substring(0, 60)}...`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Ignore "already exists" errors
      if (message.includes("already exists") || message.includes("EquivalentSchemaRuleAlreadyExists")) {
        console.log(`  SKIP (exists): ${statement.substring(0, 60)}...`);
      } else {
        console.error(`  FAIL: ${statement.substring(0, 60)}...`);
        console.error(`        ${message}`);
      }
    }
  }

  // Seed team nodes from team config files
  console.log("\nSeeding team nodes...");
  // Add new teams here as they onboard.
  // Each team also needs a YAML config in teams/ and a mapping in config/team-mapping.yaml.
  const teams = [
    { id: "ci-platform", name: "CI Platform" },
  ];

  for (const team of teams) {
    await runWrite(
      `MERGE (t:Team {id: $id}) ON CREATE SET t.name = $name, t.created_at = datetime()`,
      { id: team.id, name: team.name }
    );
    console.log(`  Team: ${team.name}`);
  }

  // Seed module nodes from team configs
  console.log("\nSeeding module nodes...");
  // CI Platform modules. Add more as teams onboard.
  const modules = [
    { name: "pipeline", path_prefixes: ["pipeline/", "pkg/pipeline/"] },
    { name: "stage-executor", path_prefixes: ["pipeline/stage/", "pkg/stage/"] },
    { name: "trigger", path_prefixes: ["trigger/", "pkg/trigger/"] },
    { name: "commons-cache", path_prefixes: ["commons/cache/"] },
    { name: "ci-manager", path_prefixes: ["ci-manager/", "cmd/ci-manager/"] },
  ];

  for (const mod of modules) {
    await runWrite(
      `MERGE (m:Module {name: $name}) ON CREATE SET m.path_prefixes = $prefixes`,
      { name: mod.name, prefixes: mod.path_prefixes }
    );
    console.log(`  Module: ${mod.name}`);
  }

  // Seed module -> team ownership
  console.log("\nLinking modules to teams...");
  const ownership = [
    { module: "pipeline", team: "ci-platform" },
    { module: "stage-executor", team: "ci-platform" },
    { module: "trigger", team: "ci-platform" },
    { module: "ci-manager", team: "ci-platform" },
    { module: "commons-cache", team: "ci-platform" },
  ];

  for (const link of ownership) {
    await runWrite(
      `MATCH (m:Module {name: $module}), (t:Team {id: $team})
       MERGE (m)-[:OWNED_BY]->(t)`,
      { module: link.module, team: link.team }
    );
    console.log(`  ${link.module} -> ${link.team}`);
  }

  console.log("\nDatabase initialization complete.");
  await closeDriver();
}

initializeDatabase().catch((err) => {
  console.error("Initialization failed:", err);
  process.exit(1);
});
