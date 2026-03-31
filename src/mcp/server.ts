import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerTools } from "./tools.js";
import { registerPrompts } from "./prompts.js";
import { dashboardApi } from "../dashboard/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ship",
    version: "1.0.0",
  });

  registerTools(server);
  registerPrompts(server);

  return server;
}

export async function startHttpServer(port: number, host: string) {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed. Use POST for MCP requests." }));
  });

  app.delete("/mcp", async (req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed." }));
  });

  // Dashboard API
  app.use("/api", dashboardApi);

  // Dashboard SPA — serve static assets, fallback to index.html for client-side routing
  const dashboardDir = path.resolve(__dirname, "../../public/dashboard");
  app.use("/dashboard", express.static(dashboardDir));
  app.get("/dashboard/{*path}", (_req, res) => {
    res.sendFile(path.join(dashboardDir, "index.html"));
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "ship-server", version: "1.0.0" });
  });

  app.listen(port, host, () => {
    console.log(`Ship MCP server listening on ${host}:${port}`);
    console.log(`  MCP endpoint: http://${host}:${port}/mcp`);
    console.log(`  Health check: http://${host}:${port}/health`);
  });
}
