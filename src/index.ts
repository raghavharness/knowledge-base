import { startHttpServer } from "./mcp/server.js";
import { closeDriver } from "./knowledge/graph.js";

const PORT = parseInt(process.env.PORT ?? "3847", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  console.log("Starting Ship MCP Server...");
  console.log(`  Neo4j: ${process.env.NEO4J_URI ?? "bolt://localhost:7687"}`);
  if (!process.env.GOOGLE_API_KEY) {
    console.error("  FATAL: GOOGLE_API_KEY is not set. Embeddings will fail.");
    process.exit(1);
  }
  console.log("  Embeddings: Google gemini-embedding-001");

  await startHttpServer(PORT, HOST);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await closeDriver();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
