import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerTools } from "./tools.js";
import { registerPrompts } from "./prompts.js";
import { dashboardApi } from "../dashboard/api.js";
import { authStore, type AuthContext } from "../auth/context.js";
import { verifyToken, extractFromHeader } from "../auth/jwt.js";

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

  // Create a single MCP server instance and reuse it for all requests.
  // The StreamableHTTPServerTransport is stateless (sessionIdGenerator: undefined),
  // so each request gets its own transport but shares the server's tool registry.
  const mcpServer = createMcpServer();

  app.post("/mcp", async (req, res) => {
    // Extract auth from Authorization header (optional — ship_register doesn't need it)
    let authContext: AuthContext | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const raw = extractFromHeader(authHeader);
        const payload = verifyToken(raw);
        authContext = {
          userId: payload.sub,
          email: payload.email,
          teams: payload.teams,
          primaryTeam: payload.teams[0],
        };
      } catch {
        // Auth failures will surface when tools call getAuthContext()
      }
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close();
    });
    await mcpServer.connect(transport);

    // Run the MCP handler within the auth context
    const handler = () => transport.handleRequest(req, res, req.body);
    if (authContext) {
      await authStore.run(authContext, handler);
    } else {
      await handler();
    }
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
