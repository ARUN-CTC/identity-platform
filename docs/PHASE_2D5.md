# Phase 2D.5 — Resource Server JWT Validation & Authorization Context

## Objective

Build the reusable Resource Server trust boundary for the externally-issued (Phase 2D.4) OAuth access token: bearer extraction, RS256/JWKS validation via an HTTP-fetched (never in-process) key source, `ServiceAccount` principal construction, request-scoped (CLS) attachment, and a generic guard — without centralizing any product-specific IAM/entitlement decision. See `docs/RESOURCE_SERVER_ARCHITECTURE.md` for the full design.

## What was implemented

New module `src/modules/resource-server/`:

- **`extractBearerToken()`** (`utils/bearer-token.util.ts`) — RFC 7617-adjacent Bearer extraction; rejects missing/empty/wrong-scheme/`Bearer`-alone/empty-token/duplicated-or-comma-joined/non-JWT-shaped headers, uniformly (`null`, never a distinguishing reason).
- **`JwksClientService`** (`services/jwks-client.service.ts`) — fetches public keys over HTTP from a configured `OAUTH_JWKS_URI`, in-memory cached, cooldown-protected (`OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS`, default 60s) against unknown-`kid` refresh amplification, in-flight-refresh de-duplication, atomic cache swap, fails closed (never throws) on any fetch/parse error. Structurally independent of `SigningKeyService` — never imports it, so it cannot access private key material even by accident.
- **`ExternalAccessTokenValidator`** (`services/external-access-token-validator.service.ts`) — the actual RS256/`kid`/signature/issuer/audience/temporal/required-claims validation, producing a strongly-typed `AuthenticatedExternalPrincipal`. A second, correctly-scoped wiring of the same proven shape `ExternalTokenService.verify()` established in Phase 2D.1 — not a competing cryptographic implementation, but genuinely independent of the signing service's own in-process key material.
- **`AuthenticatedExternalPrincipal` / `ResourceAuthorizationContext`** (`interfaces/`) — the typed, inert result and its downstream-consumable view, exactly the shapes proposed in this phase's own brief.
- **`ExternalBearerAuthGuard`** (`guards/external-bearer-auth.guard.ts`) + **`@ExpectedAudience(...)`** (`decorators/`) — the reusable, opt-in (never global) guard; attaches the principal to both the request object and a dedicated CLS store slot (`ExternalPrincipalClsStore`/`ExternalPrincipalContextService`, deliberately separate from the human/tenant `AppClsStore`).
- **`ResourceServerAuthError`/`ResourceServerErrorFilter`** (`errors/`, `filters/`) — RFC 6750-shaped `{error, error_description}` responses with `WWW-Authenticate: Bearer`, scoped to guarded routes only.
- **`requireScope()` / `assertRequestedTenantMatches()`** (`utils/`) — optional, product-owned reference helpers (never invoked by the guard itself): scope enforcement and the tenant-header-must-match-token contract (brief §17).
- **`ResourceServerDemoController`** (`controllers/`) — explicitly-marked test/support infrastructure only (`/resource-server/demo/whoami`, `/scoped`, `/tenant-bound`), proving the full pipeline against real HTTP requests; not a product endpoint, not part of the OAuth/OIDC API surface.
- **Shared refactor**: `parseScopeClaim()` extracted to `src/common/utils/oauth-scope.util.ts`, used by both `ClientCredentialsService` (Phase 2D.4, request-side scope parsing) and `ExternalAccessTokenValidator` (this phase, token-claim scope parsing) — one implementation, verified behavior-preserving by re-running the full Phase 2D.4 suite unchanged after the extraction.
- **Tests**: 44 new unit tests (bearer extraction, `JwksClientService`, `ExternalAccessTokenValidator`) + 23 new e2e tests (`tests/phase2d5-resource-server.e2e-spec.ts`), the latter the first suite in this repo to call `app.listen(0)` and point the validator at that real, listening server's own JWKS endpoint over an actual TCP socket — genuine over-the-network verification, not an in-process shortcut.

## Architecture decision resolved this phase

**Required claims vs. actual Phase 2D.4 contract**: this phase's own brief lists `scope` among the Client Credentials token's required claims; the already-approved, already-tested Phase 2D.4 issuance contract omits it entirely when no scope was requested. Per this phase's own instruction not to modify 2D.4 issuance without a correctness reason, `scope` is validated as conditionally required (string if present; absence → `scopes: []`, never "all scopes"). Documented transparently in `docs/RESOURCE_SERVER_ARCHITECTURE.md` §5, not silently reconciled.

## Security Tests

Full brief §31 matrix, each with its own passing test: wrong audience, wrong issuer (correctly signed, wrong `iss`), expired token, legacy HS256 rejected outright, forged RS256 (attacker keypair, real `kid` claimed), `alg=none`, unknown `kid`, missing bearer, malformed bearer, Basic-scheme rejected, missing `tenant_id`, missing scope accepted (per the resolved contract above), tenant-header match/mismatch (200/403), insufficient/sufficient scope (403/200), tampered `sub` (signature invalidated), multiple/ambiguous `Authorization` headers, JWKS-unreachable-with-cached-key (200), JWKS-unreachable-with-unknown-kid (401, fails closed).

## Concurrency

8+8 concurrent requests across two distinct `(ServiceAccount, Tenant)` pairs — every response's own `serviceAccountId`/`tenantId` matches its own request, zero cross-contamination, proving `ExternalPrincipalClsStore`'s per-request (`AsyncLocalStorage`) isolation under real concurrent load.

## Tests

```text
Unit:        163/163 PASS (119 pre-existing + 44 new)
E2E:         200/200 PASS (177 pre-existing + 23 new, tests/phase2d5-resource-server.e2e-spec.ts)
Security:    embedded in the E2E count above (the "Security matrix" + "JWKS availability" describe blocks, 20 tests)
Concurrency: embedded in the E2E count above (1 dedicated test, 16 concurrent requests)
```

## Build

```text
Typecheck: PASS
Build:     PASS
Prisma:    N/A — no schema change
Migration: N/A — no schema change
```

## Database

```text
Tables: 0 new   Columns: 0 new   Indexes: 0 new   Constraints: 0 new   RLS: 0 changes   Migrations: none
```

## Regression

Phases 2A / 2B / 2B.1 / 2B.2 / 2C / 2C-stabilization / 2D.1 / 2D.2 / 2D.3 / 2D.4 all still green, unedited (the one shared-utility extraction, `parseScopeClaim`, was verified behavior-preserving by re-running Phase 2D.4's own full suite unchanged).

## TravelOS Isolation

```text
Files: 0   Dependencies: 0   DB: 0   Migrations: 0   Git history: 0 (no commit made)
```

## Deferred Scope (explicitly confirmed NOT implemented)

Authorization Code, PKCE, OIDC login, `/userinfo`, MFA, Passkeys, SAML, Dynamic Client Registration, Device Authorization, Token Exchange, Impersonation, token forwarding, introspection as a normal request path, SDKs, any TravelOS integration, and any product-specific (TravelOS/Healthcare/Gym) IAM/entitlement logic.

## Known Issues

- **Low**: no rate limiting on `ExternalBearerAuthGuard`-protected routes — same pre-existing, documented gap as `docs/PHASE_2D4.md`'s own Known Issues; a production deployment should sit behind a per-client/per-IP limit.
- **Low**: per-request bearer-validation failures are not written to the durable `SecurityEventsService` audit trail (only structured `Logger` lines) — a deliberate decision (see `docs/RESOURCE_SERVER_ARCHITECTURE.md` §15's rationale: consistency with the legacy `JwtAuthGuard`'s own precedent, and avoiding a log-flooding vector on a hot, potentially attacker-triggerable path), not an oversight.
- **Low**: no metrics backend (Prometheus or equivalent) is wired — the `external_auth_*` counters the brief names are available today only as structured log lines; wiring a real backend is a future operational integration.
- **Deferred**: revocation is TTL-bounded only (no introspection) — documented, deliberate, unchanged from the existing architecture's own local-first trade-off.

## Final Decision

```text
PHASE 2D.5 — PASS
```
