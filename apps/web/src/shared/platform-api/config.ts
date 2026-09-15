import { configurePlatformApiClient } from "./client";
import { platformRefreshToken } from "./auth";
import {
  clearPlatformSession,
  emitPlatformSessionExpired,
  getPlatformAccessToken,
  getPlatformRefreshToken,
  setPlatformAccessToken,
  setPlatformRefreshToken,
} from "./session";

/**
 * Shared by the platform AuthProvider's own explicit refresh and by the
 * client's automatic 401-retry below — mirrors `shared/api/config.ts`'s
 * `refreshSession`, kept as an independent implementation for the platform
 * boundary (see client.ts's header comment).
 */
export async function refreshPlatformSession(): Promise<{ accessToken: string } | null> {
  const currentRefreshToken = getPlatformRefreshToken();
  if (!currentRefreshToken) return null;

  try {
    const tokens = await platformRefreshToken(currentRefreshToken);
    setPlatformAccessToken(tokens.accessToken);
    setPlatformRefreshToken(tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  } catch {
    clearPlatformSession();
    emitPlatformSessionExpired();
    return null;
  }
}

/** Called once when the Platform Console mounts (see PlatformAuthProvider). */
export function bootstrapPlatformApiClient(): void {
  configurePlatformApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1",
    getAccessToken: getPlatformAccessToken,
    onUnauthorized: refreshPlatformSession,
  });
}
