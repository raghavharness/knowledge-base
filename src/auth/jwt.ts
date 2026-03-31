import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;
  email: string;
  teams: string[];
  iat: number;
  exp: number;
}

export interface TokenResult {
  token: string;
  payload: JwtPayload;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sign a JWT for the given user payload.
 * Returns the compact token string and the decoded payload.
 */
export function signToken(payload: {
  userId: string;
  email: string;
  teams: string[];
}): TokenResult {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);

  const claims: Omit<JwtPayload, "iat" | "exp"> = {
    sub: payload.userId,
    email: payload.email,
    teams: payload.teams,
  };

  const token = jwt.sign(claims, secret, { expiresIn: ONE_YEAR_SECONDS });

  // Decode so we can return the full payload including iat/exp set by jsonwebtoken
  const decoded = jwt.decode(token) as JwtPayload;

  return { token, payload: decoded };
}

/**
 * Verify a JWT and return the decoded payload.
 * Throws if the token is invalid, expired, or the secret is wrong.
 */
export function verifyToken(token: string): JwtPayload {
  const secret = getSecret();
  const decoded = jwt.verify(token, secret) as JwtPayload;
  return decoded;
}

/**
 * Extract a bearer token from an Authorization header value.
 *
 * Accepts:
 *   - "Bearer <token>"
 *   - Raw token string (no "Bearer" prefix)
 *   - undefined / empty → throws
 */
export function extractFromHeader(header: string | undefined): string {
  if (!header || header.trim().length === 0) {
    throw new Error("Missing authorization header");
  }

  const trimmed = header.trim();

  if (trimmed.toLowerCase().startsWith("bearer ")) {
    const token = trimmed.slice(7).trim();
    if (token.length === 0) {
      throw new Error("Bearer token is empty");
    }
    return token;
  }

  // Treat the entire value as a raw token
  return trimmed;
}
