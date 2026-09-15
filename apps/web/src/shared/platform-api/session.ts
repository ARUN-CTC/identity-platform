/**
 * Plain module-level session store for the Platform Operator boundary —
 * the platform equivalent of `shared/api/session.ts`, kept entirely
 * separate (see client.ts's own header comment for why). No "remember me"
 * concept here: an operator console session always lives in
 * `sessionStorage` (cleared when the tab closes), never `localStorage` —
 * a deliberately shorter-lived default appropriate for a highly-privileged
 * account, not a convenience decision left to the user at login.
 */
let accessToken: string | undefined;
let refreshTokenValue: string | undefined;

const REFRESH_TOKEN_STORAGE_KEY = "identity-platform.platform.refreshToken";

export function setPlatformAccessToken(next: string | undefined): void {
  accessToken = next;
}

export function getPlatformAccessToken(): string | undefined {
  return accessToken;
}

export function setPlatformRefreshToken(next: string | undefined): void {
  refreshTokenValue = next;
  try {
    if (next) {
      sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, next);
    } else {
      sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (e.g. privacy mode) — session just won't survive a reload.
  }
}

export function getPlatformRefreshToken(): string | undefined {
  return refreshTokenValue;
}

export function readPersistedPlatformRefreshToken(): string | undefined {
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Clears every piece of platform session state, including the persisted refresh token. Does not itself navigate or touch React state. */
export function clearPlatformSession(): void {
  accessToken = undefined;
  setPlatformRefreshToken(undefined);
}

const platformSessionExpiredListeners = new Set<() => void>();

export function onPlatformSessionExpired(listener: () => void): () => void {
  platformSessionExpiredListeners.add(listener);
  return () => platformSessionExpiredListeners.delete(listener);
}

export function emitPlatformSessionExpired(): void {
  for (const listener of platformSessionExpiredListeners) listener();
}
