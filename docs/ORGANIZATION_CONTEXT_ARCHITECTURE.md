# Organization Context Architecture

Implements `docs/ORGANIZATION_CONTEXT.md`'s Option D (Hybrid) decision. This document describes what was actually built; `docs/ORGANIZATION_CONTEXT.md` remains the record of the design decision itself and is not superseded, only fulfilled.

## 1. The problem restated

A global Identity (`docs/IDENTITY_DOMAIN_MODEL.md`) can hold Memberships in many Organizations, across many Tenants. At any moment, a session must have a well-defined **current organization context** — the Organization (and therefore Tenant) that Membership resolution, role/permission resolution, RLS, and (in a future phase) product entitlement all evaluate against. Phase 2A/2B/2B.1/2B.2 all had a session pinned to exactly one Tenant from login onward; Phase 2C adds the ability to select, switch, and clear which Organization within — or beyond — that starting Tenant is active, without ever trusting the client for any part of that resolution.

## 2. Resolution order (mandatory, never reversed)

```text
Authentication (JWT verified, session confirmed not revoked)
  → Global User resolved (security_user via claims.sub)
  → Selected Organization Context requested (client names only an organizationId)
  → Resolve Organization → Resolve Tenant  (server-side: MembershipsRepository.findByUserAndOrgAnyTenant)
  → Verify Membership is ACTIVE               (server-side, live)
  → Verify Organization.status = ACTIVE       (server-side, live)
  → Verify Tenant.status not SUSPENDED/CANCELLED (server-side, live)
  → Establish Tenant RLS Context               (PrismaContextService, actingAsTenantId)
  → Evaluate Organization Authorization        (UserRolesRepository.resolveGrants(tenantId, userId, organizationId))
  → Execute request
```

Every step above the RLS line runs with **no ambient tenant GUC set** — that is precisely the chicken-and-egg problem this phase had to solve (see §4). The client supplies exactly one fact: the `organizationId` it wants to switch to. Nothing else — not `tenantId`, not a role, not a permission, not "am I still a member" — is ever taken from client input; every one of those is re-derived from the database on every call that matters.

## 3. Why not `security_user.current_organization_id`

Rejected, per the brief's own instruction, absent a compelling reason. A column on the global Identity row would make "current organization" a *property of the person*, singular — incompatible with the ordinary case this phase is explicitly required to support: Browser A → Org A, Browser B → Org B, Mobile → Org C, API client → Org D, all legitimately concurrent. The correct locus for "current organization" is the **session**, not the identity — `SecuritySession.organizationId` already existed in the schema since Phase 1 anticipating exactly this (`security.prisma`'s own comment on the field), so Phase 2C required no new column, only a new, real code path using it.

## 4. The cross-tenant discovery problem, and its RLS solution

To switch into an Organization in a *different* Tenant than the caller's current session, the platform must determine "does this Identity have an ACTIVE Membership in target `organizationId`, and if so, which Tenant is it in" — **before** any Tenant RLS context can be established, because establishing that context is precisely what depends on the answer. Ordinary `membership` RLS (`tenant_id = current_tenant_id()`) cannot answer this: there is no `current_tenant_id()` yet.

**Solution** (`database/ddl/008_organization_context.sql`): a narrow, read-only relaxation of `membership`'s own RLS policy —

```sql
CREATE POLICY tenant_isolation ON membership
    USING (tenant_id = current_tenant_id() OR user_id = current_user_id())
    WITH CHECK (tenant_id = current_tenant_id());
```

`USING` (read) now also permits a row where `user_id` matches the connection's own authenticated `current_user_id()` GUC — set exclusively by `PrismaContextService` from the ambient, server-populated `RequestContextService.userId` (itself only ever set by `JwtAuthGuard` from a verified JWT's `sub` claim), **never** from client input. This means: an authenticated caller can see their **own** Membership rows, in **any** Tenant, without a Tenant GUC — and can see **no one else's**. `WITH CHECK` (write) is completely unchanged — every Membership write remains fully tenant-gated, exactly as before. No other table's RLS was touched.

This is what `MembershipsRepository.findByUserAndOrgAnyTenant(userId, organizationId)` and `.listActiveForUser(userId)` rely on. Fetching each Membership's related `Organization`/`Tenant` rows still requires the ordinary, unrelaxed per-tenant RLS on those tables — so those are fetched with an explicit `actingAsTenantId` per discovered Tenant (the same pattern Platform Operator cross-tenant administration already established in Phase 2B.1/2B.2), not by relying on any relaxation there.

## 5. Session mechanics

- **Same-tenant switch** (target Organization's Tenant === the session's current Tenant): the existing `SecuritySession` row is mutated in place (`organizationId` only — `tenant_id`, the RLS partition key, never changes), all outstanding refresh tokens for that session are revoked, and a fresh token pair is issued.
- **Cross-tenant switch**: a `security_session` row cannot itself move between tenants — `tenant_id` is immutable, since it *is* the RLS partition key. The current session is revoked (`ORGANIZATION_CONTEXT_SWITCH` reason, in the source Tenant), and a genuinely new session is created in the target Tenant's own RLS partition (reusing `issueTokens()`, the same path login uses).
- **Clear**: always same-tenant (there is no tenant to move to) — mutates `organizationId` back to `null` on the existing session, reissues tokens.
- Every switch/clear **always** reissues both tokens — a stale token asserting the old context is never left valid; the prior refresh token is revoked immediately (`RefreshTokensRepository.revokeAllForSession`), same guarantee Phase 2A's refresh-reuse-detection already relies on elsewhere.

## 6. The access token claim

```json
{ "sub": "...", "tenantId": "...", "sessionId": "...", "email": "...", "organizationId": "... | null | (absent)" }
```

Additive to `AccessTokenClaims` (`src/modules/jwt/services/token.service.ts`) — a token minted before Phase 2C, or for a session with no organization selected, simply omits it; every consumer treats a missing/null value identically ("tenant-wide, no organization selected"). See `docs/ORGANIZATION_CONTEXT_SECURITY.md` §2 for why this claim is never trusted as authorization by itself.

## 7. Live re-validation on refresh

A session's `organizationId` is re-checked, live, on **every** `POST /v1/auth/refresh` — not carried forward from the previous access token's claim. Membership can be revoked, or the Organization/Tenant disabled, at any point during a session's lifetime (an admin action in a different browser tab, a different administrator, a scheduled deactivation). If the check fails, the session's `organizationId` is cleared to `null` (not the whole refresh rejected — the caller keeps their tenant-wide session and can pick a new context) and `organization_context.cleared_stale` is audited. This bounds the maximum staleness window for a revoked organization-context to one access-token TTL (already short, same bound Phase 2 already accepts for roles/permissions generally — `docs/TOKEN_ARCHITECTURE.md` §6) — never "until the user logs out."

## 8. Authorization resolution

`PermissionsGuard` (the only thing that changed structurally in the authorization path) now resolves grants against `(tenantId, userId, context.organizationId)` instead of `(tenantId, userId)` — this is the fix that makes an organization-scoped role grant actually *apply* once that organization has been selected as the active context; previously (Phase 2A onward) `PermissionsGuard` never passed `organizationId` at all, so organization-scoped grants were structurally invisible to every `@RequirePermissions`-gated route (they were only ever reachable by calling `UserRolesService.resolveGrants()` directly, e.g. in tests). `UserRolesRepository.resolveGrants()` itself re-validates both Membership status **and** Organization status live on every call (Phase 2C's own addition to that method — Organization status was not previously checked there at all).

## 9. What Phase 2C explicitly did not build

Per the brief: no OAuth2/OIDC/SAML/MFA/Passkeys/Service Accounts/Client Credentials/SDKs/Billing/Subscriptions/Usage Metering, no organization-level Product Entitlements or product-specific business authorization, no TravelOS integration. `ProductAccessService` (Phase 2B.2) is untouched and already takes only `(tenantId, productId)` — ready for a future phase to call once it resolves the caller's active tenant from context, no change needed there.
