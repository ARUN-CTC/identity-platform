# Phase 2D.2 — Application / OAuth Client Foundation

## Objective

Turn the existing Phase 2B `Application` entity into a production-quality OAuth client registration/configuration/validation foundation — grant-type, scope, audience, redirect-URI, and origin allow-lists, plus a composed eligibility check a future `/authorize`/`/token` implementation can call — without issuing any token. See `docs/PHASE_2D_ARCHITECTURE.md`, `docs/adr/ADR-018-application-trust-client-types.md` (as amended), `docs/APPLICATION_AUTHORIZATION.md`.

## What was implemented

- **Schema (additive)**: `application` gains `grant_types`/`allowed_scopes`/`audiences` (`TEXT[]`, deny-by-default empty) and `token_endpoint_auth_method` (`VARCHAR`, derived from `client_type`) — `database/ddl/005_product.sql` (fresh-bootstrap shape) + `database/migrations/20260913220000_application_oauth_client_config.sql` (upgrade path, backfilling `token_endpoint_auth_method='none'` for existing PUBLIC clients). Verified against a simulated pre-2D.2 state and idempotent re-run.
- **Policies** (`src/modules/applications/policies/`) — six focused, reusable, fail-closed classes plus one composed facade:
  - `ApplicationGrantPolicy` — allow-list is exactly `{authorization_code, client_credentials}`; rejects `implicit`/`password`/`device_authorization`/`token_exchange`; rejects `client_credentials` for a PUBLIC client (cannot authenticate itself).
  - `ApplicationScopePolicy` — every scope must be a standard OIDC scope or namespaced under the registering Application's own Product slug (mirrors ADR-004's permission-namespace-ownership rule).
  - `ApplicationAudiencePolicy` — rejects `*`/`all`/`any`/embedded wildcards.
  - `RedirectUriPolicy` — exact-match runtime check (no `startsWith`/`includes`/wildcard, ever); registration-time format validation (absolute URI, no fragment, no userinfo, HTTPS required except loopback, custom mobile/native schemes permitted).
  - `OriginPolicy` — same discipline, for CORS origins (no path/query/fragment, HTTPS-except-loopback).
  - `TokenEndpointAuthMethodPolicy` — `client_secret_basic`/`none`, derived strictly from `clientType`, never independently client-settable.
  - `OAuthApplicationPolicyService.checkEligibility()` — the single composed call a future `/authorize`/`/token` must use: application exists + ACTIVE, product exists + ACTIVE, grant type / scopes / audience / redirect URI all allowed. Issues no token.
- **`ApplicationsService`** — derives `tokenEndpointAuthMethod` server-side (never accepted as input); validates every configuration field at create/update time via the policies above; the cross-field rule "`authorization_code` requires at least one registered redirect URI"; P2002 (client_id collision) now translated to a clean 409.
- **Security fix** (found during this phase's own IDOR testing, not a pre-existing known issue carried in from elsewhere): `ApplicationsRepository.update()` previously spread the raw request DTO (`{...dto}`) into Prisma's `data`, meaning its only defense against a client sending `productId` (or any other unrecognized field) was the global `ValidationPipe`'s `forbidNonWhitelisted` — a general-purpose HTTP-layer setting, not a repository-level guarantee for this phase's own stated-critical invariant ("Application registered for Product A must not obtain access to Product B"). Fixed by naming every written field explicitly; verified the DB-level `productId` truly cannot be reassigned via this endpoint under any circumstance, independent of whatever validation pipe happens to be wired in front of it.
- **Tests**: 78 new unit tests (one spec file per policy) + 31 new e2e tests (`tests/phase2d2-application-oauth-client.e2e-spec.ts`), additive to (not a restatement of) the existing `tests/phase2b-product-registration.e2e-spec.ts`.

## Application Lifecycle

Unchanged from Phase 2B: `ACTIVE ⇄ SUSPENDED`, `→ DISABLED` (all via the generic status PATCH). Disabling/suspending never deletes the row, its `client_id`, its history, or mutates `clientSecretHash`/product/tenant entitlement/service grants — verified directly. `OAuthApplicationPolicyService.checkEligibility()` treats only `ACTIVE` as eligible; `SUSPENDED`/`DISABLED` are both `application_inactive`.

## Client Credentials

Unchanged from Phase 2B — `clientId` (public, high-entropy, `cli_`-prefixed, DB-unique) and `clientSecretHash` (SHA-256 of a 256-bit random secret, plaintext shown exactly once at creation) were already production-quality and reused as-is; this phase added no new credential material, only the configuration allow-lists governing how a credential may be *used*.

## Grant Policy

`{authorization_code, client_credentials}` only, enforced at registration (`ApplicationGrantPolicy.validateGrantTypesForRegistration`) and ready for runtime use (`isGrantTypeAllowed`) — deny-by-default (empty `grantTypes` authorizes nothing).

## Scope Policy

OAuth scope (`allowedScopes` — "what may this Application call") remains structurally separate from IAM permission ("what may this principal actually do," product-owned, ADR-004) — no code path anywhere derives one from the other. Namespace-owned per Product slug, standard OIDC scopes excepted.

## Audience Policy

Explicit allow-list, no wildcard value accepted in any spelling — a token for one resource API can never be requested by an Application not explicitly configured for it.

## Redirect URI / Origin Security

Exact string match only at runtime; rich format validation at registration (HTTPS-except-loopback, no fragments, no wildcards, custom mobile schemes permitted). Full attack matrix tested: prefix, suffix, subdomain, fragment-append, case-difference, and wildcard attacks all denied.

## Authorization

Unchanged Platform Operator boundary (`PlatformJwtAuthGuard`/`PlatformPermissionsGuard`, `APPLICATION_MANAGE`/`APPLICATION_VIEW`) — a tenant-scoped token is rejected outright (401), not merely denied a permission (verified again for the new fields specifically, not just inherited from Phase 2B's own tests). IDOR: a nonexistent id 404s; `productId` is immutable at the repository layer (see Security fix above), not merely at the DTO layer.

## Database

```text
Database changes: 4 new columns on `application` (additive)
Migration: PASS (simulated pre-2D.2 state + idempotent re-run)
RLS changes: 0 — Application remains platform-level, no RLS (unchanged)
```

## Tests

```text
Unit:     106/106 PASS (28 pre-existing + 78 new)
E2E:      124/124 PASS (93 pre-existing + 31 new)
Security: covered within the e2e suite above (full attack matrix §H below)
```

## Build

```text
Typecheck: PASS
Build:     PASS
Prisma:    PASS
```

## TravelOS Isolation

```text
Files: 0
Dependencies: 0
DB: 0
Migrations: 0
Git history: 0
```

## Deferred Scope (explicitly confirmed NOT implemented)

Authorization Code flow, PKCE, Client Credentials grant flow, `/token`, `/authorize`, `/userinfo`, `/revoke`, `/introspect`, OIDC, `ServiceAccount`, `ServiceAccountTenantGrant`, refresh-token changes, token exchange, impersonation, MFA, Passkeys, SAML, SCIM, social login, dynamic client registration, device authorization grant, developer portal, SDK, API marketplace, billing, subscriptions, metering, product integration, TravelOS integration.

## Known Issues

- **Low**: no automatic secret expiry (rotation remains a manual operator action, unchanged from Phase 2B).
- **Low**: `OAuthApplicationPolicyService` has no HTTP endpoint calling it yet — by design, exercised only by its own tests until `/token`/`/authorize` exist.
- **Low**: the e2e test harness (`Test.createTestingModule`) does not register `main.ts`'s global `ValidationPipe`, so `forbidNonWhitelisted` is not exercised by any e2e suite in this repo, this phase's included — mitigated here by the repository-layer fix above (immutability no longer depends on that pipe at all) and by asserting on persisted database state rather than HTTP status alone wherever this mattered.

## Final Decision

```text
PHASE 2D.2 PASS — READY FOR PHASE 2D.3
```
