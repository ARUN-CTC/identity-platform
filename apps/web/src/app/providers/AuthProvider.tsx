import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  clearSession,
  getCurrentUser,
  isRememberedSession,
  listMyOrganizations,
  login as loginRequest,
  logout as logoutRequest,
  onSessionExpired,
  readPersistedRefreshToken,
  refreshSession,
  setSessionAccessToken,
  setSessionOrganizationId,
  setSessionRefreshToken,
  setSessionTenantCode,
  setSessionTenantId,
  setSessionUserId,
  switchOrganizationContext,
  clearOrganizationContext,
  type AuthTokens,
  type CurrentRole,
  type MyOrganization,
} from "@/shared/api";
import type { AuthUser, OrganizationContext, Tenant } from "@/shared/types/auth";
import { decodeJwtPayload, type AccessTokenClaims } from "@/shared/utils/jwt";

import { useNotify } from "./NotificationProvider";

export interface LoginCredentials {
  tenantCode: string;
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * Dev-mode session bootstrap — a convenience for local development only.
 * Deliberately has NO hardcoded fallback credentials (unlike TravelOS's own
 * equivalent): every one of these must be explicitly set in a gitignored
 * `.env.local` or this path never runs. Hard-gated on `import.meta.env.DEV`
 * — a Vite build-time constant that is `false` in every production build,
 * so this code path is physically absent from a prod bundle regardless of
 * env vars. Real interactive login (LoginPage) is the only path in a
 * production build.
 */
const DEV_LOGIN =
  import.meta.env.DEV &&
  import.meta.env.VITE_DEV_TENANT_CODE &&
  import.meta.env.VITE_DEV_EMAIL &&
  import.meta.env.VITE_DEV_PASSWORD
    ? {
        tenantCode: import.meta.env.VITE_DEV_TENANT_CODE as string,
        email: import.meta.env.VITE_DEV_EMAIL as string,
        password: import.meta.env.VITE_DEV_PASSWORD as string,
      }
    : null;

function initials(a: string, b?: string): string {
  return b ? (a[0] + b[0]).toUpperCase() : a.slice(0, 2).toUpperCase();
}

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]/).filter(Boolean);
  return parts.length > 1 ? initials(parts[0], parts[1]) : initials(local);
}

/** Interim, JWT-only user shown for the brief window between token issuance and `/auth/me` resolving. */
function userFromClaims(claims: AccessTokenClaims | null, fallbackEmail: string): AuthUser {
  const email = claims?.email ?? fallbackEmail;
  return { id: claims?.sub ?? "unknown", displayName: email, email, initials: initialsFromEmail(email) };
}

/** The authoritative user shape once `/auth/me` has resolved — real name instead of an email-derived guess. */
function userFromMe(me: Awaited<ReturnType<typeof getCurrentUser>>["user"]): AuthUser {
  const name = [me.firstName, me.lastName].filter(Boolean).join(" ");
  return {
    id: me.id,
    displayName: name || me.email,
    email: me.email,
    initials: me.firstName ? initials(me.firstName, me.lastName ?? undefined) : initialsFromEmail(me.email),
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  /**
   * The authenticated caller's tenant + effective permission codes, from
   * `GET /auth/me` — the authoritative source for anything beyond identity.
   * Null/empty until that call resolves (briefly, right after login/session
   * restore) or if it failed (see the catch block in `establishSession`,
   * which fails closed: permissions stay empty rather than guessing).
   */
  tenant: Tenant | null;
  permissions: string[];
  /** The authenticated caller's own role grants (id/code/name), from `/auth/me` — e.g. for display in UserMenu. Not used for authorization decisions; `permissions` is. */
  roles: CurrentRole[];
  /** The organization the caller is currently acting within — null means tenant-wide, the default. `permissions` above already reflects this selection. */
  organizationContext: OrganizationContext | null;
  /** Every organization the caller holds at least one ACTIVE membership in, from `GET /me/organizations` — the allow-list a context switcher offers. Empty for most users. */
  availableOrganizations: MyOrganization[];
  /** This browser's own session id, from `/auth/me`'s `session.id` — lets the UI mark "this device" in a sessions list (see MySessionsPage) without decoding the JWT itself. Null until `/auth/me` resolves. */
  sessionId: string | null;
  isAuthenticated: boolean;
  /** True during initial session bootstrap (restoring/dev-login), covering both token issuance and the `/auth/me` fetch that follows it. */
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  /** Real server-side logout (revokes the session + its refresh tokens) plus full local cleanup. Safe to call even if the server call fails. */
  signOut: () => Promise<void>;
  /**
   * Selects (or clears, if omitted) the organization-context to act within.
   * The backend validates the requested id against the caller's own
   * memberships — an unauthorized/nonexistent id rejects with an ApiError
   * (403) and leaves the current context untouched; callers should surface
   * that rather than assume success. Unlike login/refresh, the backend's
   * own context-switch endpoints return only fresh tokens (no `me` payload
   * in the same call — see shared/api/auth.ts's doc comment), so this
   * always follows up with its own `getCurrentUser()` call before updating
   * state. On success, clears the entire query cache — no organization-
   * scoped data may survive a context switch.
   */
  switchOrganization: (organizationId?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<CurrentRole[]>([]);
  const [organizationContext, setOrganizationContext] = useState<OrganizationContext | null>(null);
  const [availableOrganizations, setAvailableOrganizations] = useState<MyOrganization[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const bootstrapped = useRef(false);

  function applyMe(me: Awaited<ReturnType<typeof getCurrentUser>>, organizations: MyOrganization[]) {
    setUser(userFromMe(me.user));
    setTenant({ id: me.tenant.id, name: me.tenant.tenantName, code: me.tenant.tenantCode });
    setPermissions(me.permissions);
    setRoles(me.roles);
    setOrganizationContext(
      me.organizationContext.organizationId
        ? { id: me.organizationContext.organizationId, name: me.organizationContext.organizationName ?? "" }
        : null,
    );
    setSessionOrganizationId(me.organizationContext.organizationId ?? undefined);
    setAvailableOrganizations(organizations);
    setSessionId(me.session.id);
  }

  /**
   * Called after every path that issues fresh tokens (login, refresh-backed
   * session restore, dev auto-login). `tokens`/JWT claims give us an
   * immediate, synchronous identity (sub/tenantId/sessionId/email — the only
   * fields the access token actually carries) so the UI has something to
   * render right away; the `GET /auth/me` + `GET /me/organizations` calls
   * that follow are the authoritative source for everything else (real
   * name, tenant record, effective permissions, organization context) and
   * overwrite the JWT-derived guess once they resolve. This mirrors
   * PermissionsGuard's own real DB-backed permission resolution —
   * `/auth/me` calls the exact same resolver — so the frontend can never
   * see a permission set the backend wouldn't also enforce.
   */
  async function establishSession(
    tokens: AuthTokens,
    fallbackEmail: string,
    tenantCode?: string,
    rememberMe = false,
  ) {
    const claims = decodeJwtPayload<AccessTokenClaims>(tokens.accessToken);
    setSessionAccessToken(tokens.accessToken);
    setSessionRefreshToken(tokens.refreshToken, rememberMe);
    setSessionTenantId(claims?.tenantId);
    setSessionUserId(claims?.sub);
    if (tenantCode) setSessionTenantCode(tenantCode);
    setUser(userFromClaims(claims, fallbackEmail));
    setIsAuthenticated(true);

    try {
      const [me, organizations] = await Promise.all([getCurrentUser(), listMyOrganizations()]);
      applyMe(me, organizations);
    } catch {
      // Session is still valid (tokens above are real) — just missing the
      // richer context. Fail closed: permissions stays empty, so every
      // PermissionGate/PermissionRoute denies until the next successful
      // fetch, rather than guessing from stale/absent data.
      notify({
        message: "Couldn't load your account details — some actions may be hidden. Contact an administrator if this persists.",
        severity: "warning",
        autoHideDuration: null,
      });
    }
  }

  function clearAuthState() {
    clearSession();
    setUser(null);
    setTenant(null);
    setPermissions([]);
    setRoles([]);
    setOrganizationContext(null);
    setAvailableOrganizations([]);
    setSessionId(null);
    setIsAuthenticated(false);
    // Wipe every cached query — nothing from the previous session's tenant/
    // organization/user scope may leak into whatever logs in next.
    queryClient.clear();
  }

  useEffect(() => {
    // Deliberately no cleanup-based cancellation here: `bootstrapped` already
    // guarantees the async work below only ever starts once. Pairing a ref
    // guard with a `cancelled` flag set by the effect's own cleanup is a
    // trap under StrictMode's dev-mode double-invoke — the first invocation's
    // cleanup fires (setting cancelled=true) before its in-flight bootstrap()
    // resolves, so `setIsLoading(false)` never runs and the app is stuck on
    // the loading splash forever. AuthProvider wraps the whole app for its
    // entire lifetime and never really unmounts mid-bootstrap, so there's
    // nothing to guard against once the ref does its job.
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    async function bootstrap() {
      const persisted = readPersistedRefreshToken();
      if (persisted) {
        // Re-establishes in-memory state from whichever storage it was
        // actually read from — must not silently move a remembered token
        // into sessionStorage (or vice versa) on every app boot.
        setSessionRefreshToken(persisted, isRememberedSession());
        const refreshed = await refreshSession();
        if (refreshed) {
          const claims = decodeJwtPayload<AccessTokenClaims>(refreshed.accessToken);
          setSessionTenantId(claims?.tenantId);
          setSessionUserId(claims?.sub);
          setUser(userFromClaims(claims, claims?.email ?? ""));
          setIsAuthenticated(true);
          try {
            const [me, organizations] = await Promise.all([getCurrentUser(), listMyOrganizations()]);
            applyMe(me, organizations);
          } catch {
            notify({
              message: "Couldn't load your account details — some actions may be hidden. Contact an administrator if this persists.",
              severity: "warning",
              autoHideDuration: null,
            });
          }
          setIsLoading(false);
          return;
        }
        // refreshSession() already cleared session state on failure — fall through.
      }

      if (DEV_LOGIN) {
        try {
          const tokens = await loginRequest({ ...DEV_LOGIN, deviceInfo: "Identity Platform Web (dev bootstrap)" });
          await establishSession(tokens, DEV_LOGIN.email, DEV_LOGIN.tenantCode);
        } catch {
          notify({
            message: "Dev auto-login failed — sign in manually.",
            severity: "warning",
            autoHideDuration: 6000,
          });
        }
      }

      setIsLoading(false);
    }

    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; bootstrapped ref guards StrictMode's double-invoke
  }, []);

  // A 401 the client couldn't recover from (no/expired refresh token) — move to signed-out state.
  useEffect(() => {
    return onSessionExpired(() => {
      setUser(null);
      setTenant(null);
      setPermissions([]);
      setRoles([]);
      setOrganizationContext(null);
      setAvailableOrganizations([]);
      setSessionId(null);
      setIsAuthenticated(false);
      queryClient.clear();
      notify({ message: "Your session has expired. Please sign in again.", severity: "warning", autoHideDuration: 8000 });
    });
  }, [queryClient, notify]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      tenant,
      permissions,
      roles,
      organizationContext,
      availableOrganizations,
      sessionId,
      isAuthenticated,
      isLoading,
      login: async (credentials) => {
        const tokens = await loginRequest({ ...credentials, deviceInfo: "Identity Platform Web" });
        await establishSession(tokens, credentials.email, credentials.tenantCode, credentials.rememberMe);
      },
      signOut: async () => {
        try {
          await logoutRequest();
        } catch {
          // Best-effort — local cleanup below still needs to happen even if
          // the server call fails (network error, already-expired session).
        }
        clearAuthState();
      },
      switchOrganization: async (organizationId) => {
        const tokens = organizationId
          ? await switchOrganizationContext(organizationId)
          : await clearOrganizationContext();
        // The new access token embeds the switched context's claims — every
        // subsequent request (including the ones queryClient.clear() is
        // about to trigger) must use it, not the pre-switch token.
        setSessionAccessToken(tokens.accessToken);
        const [me, organizations] = await Promise.all([getCurrentUser(), listMyOrganizations()]);
        applyMe(me, organizations);
        // No organization-scoped query may keep showing data resolved under
        // the previous context — clearing everything is the same treatment
        // logout already gets, and the simplest way to guarantee it.
        queryClient.clear();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- establishSession/clearAuthState are stable per render body, not memoized separately
    [user, tenant, permissions, roles, organizationContext, availableOrganizations, sessionId, isAuthenticated, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
