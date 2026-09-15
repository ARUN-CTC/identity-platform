import { configureApiClient } from "./client";
import { refreshToken as refreshTokenRequest } from "./auth";
import {
  clearSession,
  emitSessionExpired,
  getSessionContext,
  getSessionRefreshToken,
  isRememberedSession,
  setSessionAccessToken,
  setSessionRefreshToken,
} from "./session";

/**
 * Shared by AuthProvider's own explicit refresh() and by the client's
 * automatic 401-retry below — both need the exact same "call /auth/refresh,
 * persist the rotated tokens" logic, and must never run concurrently (see
 * client.ts's refreshInFlight dedup, which this function's caller sits
 * behind for the automatic path).
 */
export async function refreshSession(): Promise<{ accessToken: string } | null> {
  const currentRefreshToken = getSessionRefreshToken();
  if (!currentRefreshToken) return null;

  try {
    const tokens = await refreshTokenRequest(currentRefreshToken);
    setSessionAccessToken(tokens.accessToken);
    // Rotation preserves the session's original "remember me" duration
    // server-side — keep writing the rotated token to the same storage the
    // original came from.
    setSessionRefreshToken(tokens.refreshToken, isRememberedSession());
    return { accessToken: tokens.accessToken };
  } catch {
    clearSession();
    emitSessionExpired();
    return null;
  }
}

/**
 * Called once at app startup (see main.tsx). `getContext` reads whatever
 * AuthProvider has written to session.ts at request time — this file never
 * holds the values itself, so a login/logout/organization-switch takes
 * effect on the very next API call with no reconfiguration needed.
 */
export function bootstrapApiClient(): void {
  configureApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1",
    getContext: getSessionContext,
    onUnauthorized: refreshSession,
  });
}
