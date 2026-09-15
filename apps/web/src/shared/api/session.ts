/**
 * Plain module-level session store, deliberately outside React. It exists
 * because client.ts's `apiRequest` needs to read the current
 * accessToken/tenantId/userId/organizationId on every call (see config.ts's
 * `getContext`), but that call happens from a plain function — not from a
 * component that could use context. AuthProvider writes here whenever its
 * own React state changes; nothing else should write to it.
 */
let accessToken: string | undefined;
let refreshTokenValue: string | undefined;
let tenantId: string | undefined;
let userId: string | undefined;
let organizationId: string | undefined;
let tenantCode: string | undefined;

/**
 * The refresh token is the one piece of session state that needs to
 * survive a page reload (the access token is short-lived and cheap to
 * re-derive via refresh; re-deriving *that* requires the refresh token
 * itself to still be around).
 *
 * Backed by sessionStorage by default — cleared when the tab closes, not
 * merely on logout — since the backend hands tokens back in the response
 * body rather than an httpOnly cookie. "Remember me" at login is the one,
 * explicit, user-consented exception: that token is written to
 * localStorage instead, which is the only way a long-lived backend refresh
 * token can survive a closed tab/browser restart — a long TTL sitting in
 * sessionStorage would still vanish on tab close and accomplish nothing
 * observable. The REMEMBER_ME_STORAGE_KEY marker (always in localStorage,
 * never sensitive) is what readPersistedRefreshToken() below checks to know
 * which storage to read back from on the next page load.
 */
const REFRESH_TOKEN_STORAGE_KEY = "identity-platform.refreshToken";
const REMEMBER_ME_STORAGE_KEY = "identity-platform.rememberMe";
const TENANT_CODE_STORAGE_KEY = "identity-platform.tenantCode";

export function setSessionAccessToken(next: string | undefined): void {
  accessToken = next;
}

export function setSessionRefreshToken(next: string | undefined, remember = false): void {
  refreshTokenValue = next;
  try {
    if (next && remember) {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, next);
      localStorage.setItem(REMEMBER_ME_STORAGE_KEY, "1");
      sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    } else if (next) {
      sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, next);
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      localStorage.removeItem(REMEMBER_ME_STORAGE_KEY);
    } else {
      // Clearing (logout) — remove from both, regardless of which was active.
      sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      localStorage.removeItem(REMEMBER_ME_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (e.g. privacy mode) — session just won't survive a reload.
  }
}

export function getSessionRefreshToken(): string | undefined {
  return refreshTokenValue;
}

/** Whether the current (or, before login re-establishes it, the persisted) refresh token is the "remember me" (localStorage) kind — callers rewriting a rotated token need this to keep writing to the same storage the original came from. */
export function isRememberedSession(): boolean {
  try {
    return localStorage.getItem(REMEMBER_ME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Reads whatever was persisted from a previous page load, without changing in-memory state. */
export function readPersistedRefreshToken(): string | undefined {
  try {
    if (localStorage.getItem(REMEMBER_ME_STORAGE_KEY) === "1") {
      return localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? undefined;
    }
    return sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setSessionTenantId(next: string | undefined): void {
  tenantId = next;
}

/**
 * Display-only — the tenant *code* the user typed at login (e.g. "ACME"),
 * not sent as a header (the backend derives tenant scoping from the JWT).
 * Persisted alongside the refresh token purely so the UI has something
 * human-readable to show immediately after a session restore, without an
 * extra round-trip.
 */
export function setSessionTenantCode(next: string | undefined): void {
  tenantCode = next;
  try {
    if (next) sessionStorage.setItem(TENANT_CODE_STORAGE_KEY, next);
    else sessionStorage.removeItem(TENANT_CODE_STORAGE_KEY);
  } catch {
    // sessionStorage unavailable — non-critical, display-only value.
  }
}

export function getSessionTenantCode(): string | undefined {
  return tenantCode ?? readPersistedTenantCode();
}

function readPersistedTenantCode(): string | undefined {
  try {
    return sessionStorage.getItem(TENANT_CODE_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setSessionUserId(next: string | undefined): void {
  userId = next;
}

export function setSessionOrganizationId(next: string | undefined): void {
  organizationId = next;
}

export function getSessionContext() {
  return { accessToken, tenantId, userId, organizationId };
}

/** Clears every piece of session state, including the persisted refresh token. Does not itself navigate or touch React state. */
export function clearSession(): void {
  accessToken = undefined;
  tenantId = undefined;
  userId = undefined;
  organizationId = undefined;
  setSessionRefreshToken(undefined);
  setSessionTenantCode(undefined);
}

/**
 * Fired when the client's 401-retry gives up (refresh failed or there was
 * no refresh token to try) — see config.ts's `onUnauthorized`. AuthProvider
 * subscribes to move its React state to "signed out"; this module has no
 * React dependency itself, so it can be called from the plain-function API
 * boundary.
 */
const sessionExpiredListeners = new Set<() => void>();

export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

export function emitSessionExpired(): void {
  for (const listener of sessionExpiredListeners) listener();
}
