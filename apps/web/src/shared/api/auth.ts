import { apiRequest } from "./client";

// Mirrors src/modules/authentication/dto/login.dto.ts
export interface LoginInput {
  tenantCode: string;
  email: string;
  password: string;
  deviceInfo?: string;
  /** Issues a longer-lived refresh token when true. */
  rememberMe?: boolean;
}

// Mirrors src/modules/authentication/dto/forgot-password.dto.ts
export interface ForgotPasswordInput {
  tenantCode: string;
  email: string;
}

// Mirrors src/modules/authentication/dto/reset-password.dto.ts (newPassword: min 8 chars)
export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

// Mirrors src/modules/authentication/dto/change-password.dto.ts
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

// Mirrors AuthTokens in src/modules/authentication/services/authentication.service.ts
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  /** Access-token TTL in seconds. */
  expiresIn: number;
}

// Mirrors src/modules/authentication/entities/me.entity.ts
export interface CurrentUser {
  id: string;
  email: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  status: string;
}

export interface CurrentTenant {
  id: string;
  tenantCode: string;
  tenantName: string;
}

export interface CurrentRole {
  id: string;
  roleCode: string;
  roleName: string;
}

export interface CurrentSession {
  id: string;
  expiresAt: string;
}

/** Null fields mean "no organization selected" (tenant-wide) — see MeEntity's own doc comment on the backend. */
export interface CurrentOrganizationContext {
  organizationId: string | null;
  organizationName: string | null;
}

/**
 * Response for GET /auth/me — the authenticated caller's own session/
 * security context in one call. `roles`/`permissions` are the caller's
 * *effective* grants for `organizationContext` (tenant-wide grants always
 * apply, plus any grant scoped specifically to the selected organization).
 * `availableOrganizations` is deliberately NOT part of this call — see
 * `listMyOrganizations()` below, a separate (cross-tenant) query.
 */
export interface MeResult {
  user: CurrentUser;
  tenant: CurrentTenant;
  organizationContext: CurrentOrganizationContext;
  roles: CurrentRole[];
  permissions: string[];
  session: CurrentSession;
}

// Mirrors src/modules/authentication/entities/my-organization.entity.ts
export interface MyOrganization {
  organizationId: string;
  organizationName: string;
  organizationStatus: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: string;
  membershipStatus: string;
}

const AUTH_BASE = "/auth";
const ME_BASE = "/me";

export function login(input: LoginInput): Promise<AuthTokens> {
  return apiRequest<AuthTokens>(`${AUTH_BASE}/login`, { method: "POST", body: input });
}

/**
 * Refresh tokens are opaque, server-tracked, and rotate on every use — the
 * response's `refreshToken` must replace whatever was passed in; reusing an
 * already-rotated token gets the whole session revoked server-side (reuse
 * detection). Callers must never issue two refresh calls with the same
 * token concurrently — see client.ts's deduped-refresh handling for how the
 * app avoids that.
 */
export function refreshToken(refreshToken: string): Promise<AuthTokens> {
  return apiRequest<AuthTokens>(`${AUTH_BASE}/refresh`, { method: "POST", body: { refreshToken } });
}

/** Revokes the caller's current session (identified server-side from the JWT's sessionId) and its refresh tokens. */
export function logout(): Promise<null> {
  return apiRequest<null>(`${AUTH_BASE}/logout`, { method: "POST" });
}

export function changePassword(input: ChangePasswordInput): Promise<null> {
  return apiRequest<null>(`${AUTH_BASE}/password/change`, { method: "POST", body: input });
}

/**
 * Always resolves the same way (200, generic message) regardless of whether
 * tenantCode/email matched a real account — never reveals which emails have
 * accounts. If a match exists, a reset-link email is sent.
 */
export function forgotPassword(input: ForgotPasswordInput): Promise<null> {
  return apiRequest<null>(`${AUTH_BASE}/password/forgot`, { method: "POST", body: input });
}

/** Completes a reset using the token from the reset-password email link. Revokes every other session for the account on success. */
export function resetPassword(input: ResetPasswordInput): Promise<null> {
  return apiRequest<null>(`${AUTH_BASE}/password/reset`, { method: "POST", body: input });
}

/**
 * "Who am I?" — identity comes exclusively from the Bearer token; there is
 * no way to request another user's context. Call after login/session
 * restore/refresh/organization-switch to get the authoritative
 * user/tenant/roles/permissions in one round trip.
 */
export function getCurrentUser(): Promise<MeResult> {
  return apiRequest<MeResult>(`${AUTH_BASE}/me`);
}

/** Every organization this authenticated (global) Identity holds an ACTIVE membership in, across every tenant — the allow-list `switchOrganizationContext()` validates a requested id against server-side. */
export function listMyOrganizations(): Promise<MyOrganization[]> {
  return apiRequest<MyOrganization[]>(`${ME_BASE}/organizations`);
}

/**
 * Selects the organization-context the caller is acting within. Validated
 * server-side against the caller's own ACTIVE memberships — an id the
 * caller has no membership in is rejected with 403, never silently
 * granted. Returns a fresh token pair reflecting the new context (its
 * claims carry the selection) — this call does NOT also return the
 * resulting `MeResult`; callers must persist the new `accessToken` (see
 * AuthProvider) and then call `getCurrentUser()` separately for the
 * refreshed roles/permissions/organizationContext.
 */
export function switchOrganizationContext(organizationId: string): Promise<AuthTokens> {
  return apiRequest<AuthTokens>(`${AUTH_BASE}/context/switch`, { method: "POST", body: { organizationId } });
}

/** Returns to tenant-wide context (no organization selected). Same two-step contract as switchOrganizationContext() — fresh tokens only; call getCurrentUser() afterward for the refreshed context. */
export function clearOrganizationContext(): Promise<AuthTokens> {
  return apiRequest<AuthTokens>(`${AUTH_BASE}/context/clear`, { method: "POST" });
}
