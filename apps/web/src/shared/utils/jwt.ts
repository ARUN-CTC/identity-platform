/**
 * Decodes (never verifies — verification is the backend's job) a JWT's
 * payload segment. Used only to read display/context claims (sub,
 * tenantId, email) out of an access token we already trust because we just
 * received it directly from POST /auth/login over HTTPS-in-prod.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  try {
    const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as T;
  } catch {
    return null;
  }
}

export interface AccessTokenClaims {
  sub: string;
  tenantId: string;
  sessionId: string;
  email: string;
  organizationId?: string | null;
}
