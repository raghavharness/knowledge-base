import { AsyncLocalStorage } from "node:async_hooks";
import { verifyToken, extractFromHeader } from "./jwt.js";

export interface AuthContext {
  userId: string;
  email: string;
  teams: string[];
  primaryTeam: string;
}

export const authStore = new AsyncLocalStorage<AuthContext>();

/**
 * Get the auth context for the current request.
 * Checks (in order):
 *  1. AsyncLocalStorage (set from Authorization header in server.ts)
 *  2. Token passed as tool parameter (fallback for MCP clients)
 * Throws if neither is available.
 */
export function getAuthContext(token?: string): AuthContext {
  // Try header-based auth first
  const ctx = authStore.getStore();
  if (ctx) return ctx;

  // Fall back to token parameter
  if (token) {
    try {
      const raw = extractFromHeader(token);
      const payload = verifyToken(raw);
      return {
        userId: payload.sub,
        email: payload.email,
        teams: payload.teams,
        primaryTeam: payload.teams[0],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("malformed") || message.includes("invalid")) {
        throw new Error(
          `Invalid token: "${token.slice(0, 20)}..." is not a valid JWT. ` +
          `Read the token from ~/.ship/token file (cat ~/.ship/token). ` +
          `If the file doesn't exist, call ship_register first to get a token and save it there.`
        );
      }
      throw err;
    }
  }

  throw new Error(
    "Not authenticated. Pass your JWT token (read from ~/.ship/token) in the 'token' parameter, " +
    "or include it in the Authorization header."
  );
}
