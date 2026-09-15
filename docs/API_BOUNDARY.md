# API Boundary

The Identity Platform's entire integration surface with every product is this API. No product ever gets database access, an imported domain module, or a shared ORM (`docs/DATA_OWNERSHIP.md`). This document defines the actual endpoint surface (supersedes the illustrative list in the Phase 2 brief) and the versioning strategy.

## 1. Versioning strategy (Step 10)

- Baseline: `/v1/...` for everything, now.
- **Backward compatibility**: additive changes (new optional field, new endpoint, new claim) never bump the version. A client that ignores unknown fields keeps working.
- **Breaking changes**: a removed/renamed field, a changed status code meaning, or a changed auth requirement is a breaking change and requires `/v2/...` for the affected resource group only — not a platform-wide version bump. Versioning is per-resource-group where practical (`/v1/auth` can outlive `/v2/organizations` if only the latter needs a break).
- **Deprecation**: a deprecated endpoint returns a `Deprecation` and `Sunset` HTTP header (RFC 8594) for at least 2 quarters before removal; removal itself is a breaking change subject to the same rule.
- **Version lifecycle**: at most two live major versions of any single resource group at once. No `/v1beta`/experimental prefixes — additive fields under `/v1` cover experimentation without a parallel version tree.

## 2. Authentication & session

| | |
|---|---|
| **POST /v1/auth/login** | Auth: none (public). Authz: none. Request: `{identifier, password, client_id}`. Response: `{access_token, refresh_token, identity, organizations[]}` (200) or organization-selection-required (see `ORGANIZATION_CONTEXT.md`). Errors: 401 invalid credentials, 403 tenant/subscription inactive, 423 locked. Idempotency: not idempotent (writes a `SecurityLoginAttempt` every call by design). Audit: `LOGIN_SUCCESS`/`LOGIN_FAILURE`. Rate limit: per-identifier and per-IP, aggressive backoff on repeated failure. |
| **POST /v1/auth/refresh** | Auth: refresh token (opaque, body). Authz: none beyond token validity. Request: `{refresh_token}`. Response: `{access_token, refresh_token}`. Errors: 401 invalid/expired/reused (reused triggers full session-chain revocation, see `AUTHENTICATION_ARCHITECTURE.md`). Idempotency: not idempotent (rotates on every call by design — this is the security property, not a bug). Audit: `SESSION_REFRESHED` (low-severity, sampled) / `REFRESH_TOKEN_REUSE_DETECTED` (always). Rate limit: per-session. |
| **POST /v1/auth/logout** | Auth: access token. Authz: none. Request: none. Response: 204. Idempotency: yes (revoking an already-revoked session is a no-op success). Audit: `LOGOUT`. Rate limit: standard. |
| **POST /v1/auth/context/switch** | Auth: access token. Authz: caller must hold an active Membership in target org. Request: `{organization_id}`. Response: `{access_token, refresh_token}`. Errors: 403 no membership in target org. Idempotency: yes (switching to the currently-active org is a no-op). Audit: `ORGANIZATION_CONTEXT_SWITCHED`. Rate limit: standard. |
| **POST /v1/auth/password/forgot** | Auth: none. Request: `{identifier}`. Response: 202 always (no user enumeration). Rate limit: aggressive per-identifier/IP. Audit: `PASSWORD_RESET_REQUESTED`. |
| **POST /v1/auth/password/reset** | Auth: reset token (body). Request: `{token, new_password}`. Response: 204; revokes all other sessions. Errors: 400/410 invalid or expired token. Audit: `PASSWORD_CHANGED`. |
| **POST /v1/auth/password/change** | Auth: access token. Request: `{current_password, new_password}`. Response: 204; revokes all other sessions. Audit: `PASSWORD_CHANGED`. |

## 3. Identity & sessions

| | |
|---|---|
| **GET /v1/users/me** | Auth: access token. Response: identity profile + active organization + roles/scopes (mirrors token claims plus profile fields not worth putting in the token). Rate limit: standard. |
| **PATCH /v1/users/me** | Auth: access token. Request: profile fields only (not password, not roles). Response: 200. Audit: `USER_PROFILE_UPDATED`. |
| **GET /v1/sessions** | Auth: access token. Authz: self, or `identity.session.manage` for another user's sessions. Response: list of the caller's (or target's) active sessions with device/IP/last-used. |
| **DELETE /v1/sessions/{id}** | Auth: access token. Authz: self, or `identity.session.manage`. Response: 204. Idempotency: yes. Audit: `SESSION_REVOKED`. |

## 4. Organizations & membership

| | |
|---|---|
| **GET /v1/organizations** | Auth: access token. Response: organizations the caller has a Membership in (or, with `identity.organization.read` tenant-wide, all organizations in the tenant). Pagination required. |
| **POST /v1/organizations** | Auth: access token. Authz: `identity.organization.manage`, tenant-scoped. Request: `{organization_type_id, organization_code, organization_name, ...}`. Response: 201. Idempotency: `Idempotency-Key` header required (creation endpoint). Audit: `ORGANIZATION_CREATED`. |
| **GET /v1/organizations/{id}** | Auth: access token. Authz: Membership in `{id}`, or `identity.organization.read` tenant-wide. |
| **PATCH /v1/organizations/{id}** | Authz: `identity.organization.manage` scoped to `{id}` or tenant-wide. Audit: `ORGANIZATION_UPDATED`. |
| **GET /v1/organizations/{id}/members** | Authz: Membership in `{id}` with `identity.user.read`, or tenant-wide equivalent. Pagination required. |
| **POST /v1/organizations/{id}/members** | Authz: `identity.user.manage` scoped to `{id}`. Request: `{user_id}` (existing identity) or delegates to Invitations (§6) for a new one. Audit: `MEMBERSHIP_CREATED`. |
| **DELETE /v1/organizations/{id}/members/{userId}** | Authz: `identity.user.manage` scoped to `{id}`; cannot remove the last `identity.organization.manage` holder without transferring first (prevents lockout). Audit: `MEMBERSHIP_REMOVED`. |
| **GET/POST/PATCH `/v1/organizations/{id}/units`** | Authz: `identity.organization.manage`. Deferred to Phase 2 implementation (schema exists, Phase 1 had no service/controller — see `PHASE_2_IMPLEMENTATION_PLAN.md`). |

## 5. Roles & permissions

| | |
|---|---|
| **GET /v1/roles** | Auth: access token. Authz: `identity.role.manage` or read-only equivalent, tenant-scoped (system roles always visible). |
| **POST /v1/roles** | Authz: `identity.role.manage`. Request: `{role_code, role_name, permission_codes[]}`. **Enforces grant-ceiling** (`AUTHORIZATION_ARCHITECTURE.md` §4) — every permission code in the request must already be held by the caller. Errors: 403 if any code exceeds the caller's own grants. Audit: `ROLE_CREATED`. |
| **PATCH /v1/roles/{id}/permissions** | Same grant-ceiling enforcement. Audit: `PERMISSION_CHANGED`. |
| **GET /v1/permissions** | Auth: access token. Response: full catalog (core + all registered product namespaces), filterable by namespace. |
| **POST /v1/products/{id}/permissions** | Auth: **ServiceAccount** token for that Product's Application only (not a human token). Authz: namespace ownership check — the calling ServiceAccount's Product must equal `{id}`. Request: `{code, resource, action, description}`; `code` must be prefixed with the Product's own slug. Errors: 403 if prefix doesn't match caller's product. Audit: `PRODUCT_PERMISSION_REGISTERED`. See `PRODUCT_REGISTRATION.md`. |
| **POST /v1/authorize** | Auth: access token or ServiceAccount token. Request: `{permission_code, resource_id?}`. Response: `{allowed: bool}` — the escape hatch for fine-grained, non-cached, real-time checks (`TOKEN_ARCHITECTURE.md` §6). Rate limit: generous but capped (this is a hot path for products that don't cache). |

## 6. Invitations

| | |
|---|---|
| **POST /v1/invitations** | Authz: `identity.user.manage` scoped to target organization. Request: `{email, organization_id, role_ids[]}`. Idempotency: `Idempotency-Key` required. Audit: `INVITATION_CREATED`. Rate limit: per-organization resend cooldown (carried over from Phase 1). |
| **POST /v1/invitations/{token}/accept** | Auth: none (token is the credential). Request: `{password?}` (only if the Identity doesn't already exist globally — an existing Identity accepting an invite into a *new* organization needs no password). Response: `{access_token, refresh_token}`. Audit: `INVITATION_ACCEPTED`, `MEMBERSHIP_CREATED`. |

## 7. Applications, products, platform operators, subscriptions, service accounts (platform-operator surface — not tenant-facing)

**Implemented in Phase 2B, auth updated in Phase 2B.1** (`docs/PHASE_2B.md`, `docs/PHASE_2B1.md`) — actual shape, superseding this section's original illustrative sketch. Every row below authenticates via `POST /v1/platform/auth/login` (`docs/PLATFORM_OPERATOR_LIFECYCLE.md`), never via a tenant login — a tenant-scoped token (however broad a role it carries) is rejected with 401, not merely denied a permission check:

| | |
|---|---|
| **POST /v1/products** | Auth: Platform Operator, `PRODUCT_MANAGE`. Request: `{name, slug, description?}`. 409 on a case-insensitive duplicate slug. Audit: `PRODUCT_CREATED` (scope `PLATFORM`). |
| **GET /v1/products**, **GET /v1/products/{id}** | Auth: Platform Operator, `PRODUCT_VIEW`. |
| **PATCH /v1/products/{id}** | Auth: Platform Operator, `PRODUCT_MANAGE`. Request: `{name?, description?, status?}`. Audit: `PRODUCT_UPDATED`/`PRODUCT_DISABLED`. No DELETE — status is the lifecycle mechanism. |
| **POST /v1/products/{productId}/applications** | Auth: Platform Operator, `APPLICATION_MANAGE`. 404s a nonexistent `productId`. Response includes `clientSecret` in plaintext exactly once (`CONFIDENTIAL` only — `null` for `PUBLIC`), never shown again. Audit: `APPLICATION_CREATED` + `CLIENT_CREDENTIAL_CREATED`. |
| **GET /v1/products/{productId}/applications** | Auth: Platform Operator, `APPLICATION_VIEW`. Strictly scoped to `productId` — verified not to leak another product's applications. |
| **GET /v1/applications/{id}**, **PATCH /v1/applications/{id}** | Auth: Platform Operator, `APPLICATION_VIEW`/`APPLICATION_MANAGE`. `clientSecretHash` never appears in any response from these two. Audit: `APPLICATION_UPDATED`/`APPLICATION_DISABLED`. |
| **POST/GET/GET/PATCH /v1/platform/operators**, **POST/DELETE .../permissions[/:code]** | Auth: Platform Operator, `PLATFORM_OPERATOR_VIEW`/`PLATFORM_OPERATOR_MANAGE` (grant-ceiling enforced on every permission grant). Full contract: `docs/PLATFORM_OPERATOR_LIFECYCLE.md`. |
| **POST /v1/platform/auth/{login,refresh,logout}**, **GET /v1/platform/auth/me** | No `tenantCode` — a Platform Operator may hold zero Organization Memberships. Full contract: `docs/PLATFORM_OPERATOR_LIFECYCLE.md`. |
| **GET /v1/platform/audit-events** | Auth: Platform Operator, `PLATFORM_SECURITY_VIEW`. Only `scope='PLATFORM'` events — never tenant-attributed. |

**Product Entitlement — implemented in Phase 2B.2** (`docs/PHASE_2B2.md`, `docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md`) — this is the `TenantProductSubscription` concept originally sketched below, built as `TenantProductEntitlement`:

| | |
|---|---|
| **POST /v1/platform/tenants/{tenantId}/product-entitlements** | Auth: Platform Operator, `PRODUCT_ENTITLEMENT_MANAGE`. Request: `{productId}`. Created `ACTIVE`. 409 on duplicate (sequential or concurrent). Audit: `PRODUCT_ENTITLEMENT_CREATED`. |
| **GET .../product-entitlements**, **GET .../product-entitlements/{productId}** | Auth: Platform Operator, `PRODUCT_ENTITLEMENT_VIEW`. |
| **PATCH .../product-entitlements/{productId}** | Auth: Platform Operator, `PRODUCT_ENTITLEMENT_MANAGE`. Request: `{status: ACTIVE\|SUSPENDED\|REVOKED}`. `REVOKED → ACTIVE` is rejected here — see reactivate below. Audit: `PRODUCT_ENTITLEMENT_ACTIVATED`/`_SUSPENDED`/`_REVOKED`. |
| **POST .../product-entitlements/{productId}/reactivate** | Auth: Platform Operator, `PRODUCT_ENTITLEMENT_MANAGE`. The only path from `REVOKED` back to `ACTIVE`. Audit: `PRODUCT_ENTITLEMENT_REACTIVATED`. |
| **GET /v1/product-entitlements** | Auth: any authenticated tenant user (no special permission — RLS-scoped to the caller's own tenant, same openness as `GET /v1/organizations`). Returns each entitlement plus a computed `eligible` flag (Product-status precedence already applied). |

**Not implemented — still future work** (`docs/PHASE_2_IMPLEMENTATION_PLAN.md`). Phase 2D (`docs/PHASE_2D_ARCHITECTURE.md`, `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §API Surface) has since formalized the full future OAuth/OIDC endpoint set (`/authorize`, `/token`, `/userinfo`, `/revoke`, `/introspect`, `/.well-known/*`) superseding this section's original illustrative sketch — this row now points to that formal design rather than restating it:

| | |
|---|---|
| **POST /v1/service-accounts** | `ServiceAccount` — architecture formalized by `docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md`/ADR-015/ADR-018; not built (`docs/adr/ADR-006-service-authentication.md`). |
| **POST /v1/oauth/token** (grant_type=client_credentials) | Deferred alongside `ServiceAccount` — the client-credentials grant itself is decided (ADR-006), its tenant-authorization model is now decided (ADR-015), neither is built. |
| `/authorize`, full `/token` (authorization_code+PKCE), `/userinfo`, `/revoke`, `/introspect`, `/.well-known/*` | Fully designed, not built — `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §API Surface is the authoritative endpoint-by-endpoint contract. |

## 8. Audit

| | |
|---|---|
| **GET /v1/audit/events** | Authz: `identity.audit.read`, tenant-scoped. Filterable by event type, actor, date range, resource. Pagination required (this table grows unboundedly). |

## 9. Cross-cutting requirements applied to every endpoint above

- **Idempotency**: every state-creating POST that a client might reasonably retry (login excluded — retries are semantically new attempts) accepts an `Idempotency-Key` header; the platform stores the key→response mapping for at least 24h.
- **Audit**: every state-changing endpoint writes a `SecurityEvent`/`AuditEvent` before returning success — audit writes are not best-effort/async-only for security-relevant events (see `SECURITY_ARCHITECTURE.md`).
- **Rate limiting**: unauthenticated/pre-auth endpoints (login, forgot-password, invitation-accept) are limited per-identifier and per-IP; authenticated endpoints are limited per-session/per-ServiceAccount; `/v1/authorize` gets a higher ceiling since products may call it per-request.
- **Error shape**: uniform envelope carried over from Phase 1's `AllExceptionsFilter` — no change to the error contract itself in Phase 2.
