# Phase 2D.1 — Cryptographic Foundation & External Token Trust Boundary

## Objective

Implement only the cryptographic foundation and trust boundary required before any OAuth 2.1/OIDC flow is built: RSA signing-key management, RS256 sign/verify, `kid`-based key selection, JWKS publication, and a structurally separate verification path from the existing legacy HS256 token — nothing else. See `docs/PHASE_2D_ARCHITECTURE.md` (design), `docs/adr/ADR-017-jwt-signing-key-management.md` (as amended by the Architecture Gate), and `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §0.

## What was implemented

- **`SigningKeyService`** (`src/modules/oauth/services/signing-key.service.ts`) — loads an RSA keypair from `OAUTH_PRIVATE_KEY` (PEM, `\n`-escaped single-line convention) or, outside `APP_ENV=production`, generates an ephemeral in-memory keypair at boot with a loud warning; **fails closed at startup** if `APP_ENV=production` and no key is configured. Derives a stable `kid` from `OAUTH_KEY_ID` or a SHA-256 fingerprint of the public key. Loads optional `OAUTH_RETIRED_PUBLIC_KEYS` (JSON array) as verification-only, never-signing keys — the "overlap window" rotation model, without a database table. Exposes `getJwks()`, built from `crypto.createPublicKey(pem).export({format:'jwk'})` on a public-key-only `KeyObject` — structurally incapable of emitting private fields.
- **`ExternalTokenService`** (`src/modules/oauth/services/external-token.service.ts`) — `sign()`/`verify()` for the new RS256 token type (`ExternalTokenClaims`). `verify()` pins `algorithms: ['RS256']` explicitly (never inferred from the token header), validates `iss`/`aud`/`exp`/`nbf`/signature, resolves the verification key by `kid` against `SigningKeyService`'s trusted set, and throws a categorized `ExternalTokenError` (`invalid_token`/`invalid_signature`/`invalid_algorithm`/`invalid_issuer`/`invalid_audience`/`unknown_kid`/`expired_token`/`not_yet_valid`) — never a raw library error, never logs token contents.
- **`GET /.well-known/jwks.json`** (`JwksController`) — public, unauthenticated, excluded from the `/api/v1` prefix (resolves at the exact spec-required path).
- **Legacy verifier hardening**: `TokenService.verifyAccessToken()`/`verifyPlatformAccessToken()` (`src/modules/jwt/services/token.service.ts`) now explicitly pin `algorithms: ['HS256']` — closing any reliance on an implicit library default and making the legacy/external trust boundary structural rather than incidental.
- **Configuration**: `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `OAUTH_PRIVATE_KEY`, `OAUTH_KEY_ID`, `OAUTH_RETIRED_PUBLIC_KEYS` (`.env.example`), consistent with the existing `ConfigService`/env-var convention — no new configuration system introduced.
- **Dependencies**: `jsonwebtoken` (was already present transitively via `@nestjs/jwt`; now an explicit direct dependency since `ExternalTokenService` imports it directly for `kid`-based multi-key verification, which `@nestjs/jwt`'s single-secret-configured `JwtService` wrapper doesn't support) and `@types/jsonwebtoken` — both pinned to the exact versions already resolved in `package-lock.json` (`^9.0.2`/`^9.0.5`), zero re-resolution churn.
- **Tests**: 25 new unit tests (`signing-key.service.spec.ts`, `external-token.service.spec.ts`) + 8 new e2e tests (`tests/phase2d1-external-token-trust-boundary.e2e-spec.ts`), the latter run against the real database and the real HTTP surface (JWKS fetched over HTTP, not read via DI).

## Cryptographic Architecture

```text
Legacy proprietary JWT                     NEW external (OAuth/OIDC) JWT
        │                                            │
   HS256, JWT_ACCESS_SECRET                    RS256, OAUTH_PRIVATE_KEY
        │                                            │
  TokenService.verifyAccessToken()          ExternalTokenService.verify()
  (algorithms: ['HS256'] pinned)            (algorithms: ['RS256'] pinned,
        │                                     kid resolved via SigningKeyService)
        │                                            │
  Verified ONLY inside this platform's        Verifiable by any external
  own process — no external party ever        resource server via published
  receives JWT_ACCESS_SECRET                  JWKS — no shared secret at all
```

No migration: the legacy token is permanent (Architecture Gate, Gate 1/10) — this phase adds a second, independent signing/verification path, it does not touch the first.

## JWKS

`GET /.well-known/jwks.json` → `{"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"...","n":"...","e":"AQAB"}]}`. Verified directly (unit + e2e) that private fields (`d`,`p`,`q`,`dp`,`dq`,`qi`) are structurally absent, not merely unset, and that a completely independent verifier — constructing a public key from ONLY the fetched JWK via `crypto.createPublicKey({key, format:'jwk'})` — can successfully verify a token signed by this process, with no access to `SigningKeyService` at all (`tests/phase2d1-external-token-trust-boundary.e2e-spec.ts`, "End-to-end resource-server-style verification").

## Trust Boundary

Structural, not conventional: `TokenService` never receives RS256 key material; `ExternalTokenService`/`SigningKeyService` never receive `JWT_ACCESS_SECRET`. Both verifiers additionally pin their expected algorithm explicitly (defense in depth against algorithm confusion, `docs/PHASE_2D_THREAT_MODEL.md` #7) rather than relying on that separation alone. Verified with **real, actually-issued tokens** in both directions: a genuine legacy access token (obtained via a real `/auth/login` call) is rejected by `ExternalTokenService.verify()` with `invalid_algorithm`; a genuine `ExternalTokenService`-signed token is rejected by `TokenService.verifyAccessToken()`.

## Security Tests

All of §23's security test matrix items are covered:

```text
HS256 token → external verifier:        DENY (invalid_algorithm)      — covered (unit + e2e, real token)
alg=none:                                DENY (invalid_algorithm)      — covered (unit)
RS384/RS512 (same key, wrong alg):       DENY (invalid_algorithm)      — covered (unit)
Wrong issuer:                            DENY (invalid_issuer)         — covered (unit)
Wrong audience:                          DENY (invalid_audience)       — covered (unit)
Unknown kid:                             DENY (unknown_kid)            — covered (unit)
Missing kid:                             DENY (unknown_kid)            — covered (unit)
Expired token:                           DENY (expired_token)          — covered (unit)
Future nbf:                              DENY (not_yet_valid)          — covered (unit)
Modified signature:                      DENY (invalid_signature)      — covered (unit)
Modified sub (payload tamper, no resign): DENY (invalid_signature)     — covered (unit)
Modified tenant_id/organization_id:      DENY (invalid_signature)      — covered (unit)
Public JWKS contains private material:   NEVER OCCURS                 — covered (unit + e2e, structural)
RS256 token → legacy verifier:           DENY (thrown error)           — covered (e2e, real token, both directions)
```

## Regression Tests

```text
Unit:  28/28 PASS (3 pre-existing + 25 new)
E2E:   93/93 PASS (85 pre-existing + 8 new) — all prior phases (health, 2A, 2B, 2B.1, 2B.2, 2C, 2C-stabilization) unaffected
```

## Build

```text
Typecheck: PASS
Build:     PASS
Prisma:    PASS (generate re-run clean — no schema change)
```

## Files Changed

New: `src/modules/oauth/oauth.module.ts`, `src/modules/oauth/services/{signing-key,external-token}.service.ts` (+ `.spec.ts`), `src/modules/oauth/controllers/jwks.controller.ts`, `src/modules/oauth/interfaces/{external-token-claims,jwk}.interface.ts`, `src/modules/oauth/errors/external-token-error.ts`, plus each directory's `index.ts` barrel; `tests/phase2d1-external-token-trust-boundary.e2e-spec.ts`; `docs/PHASE_2D1.md`.

Modified: `src/app.module.ts` (registers `OAuthModule`), `src/main.ts` (excludes `.well-known/jwks.json` from the versioned prefix), `src/modules/jwt/services/token.service.ts` (explicit `algorithms: ['HS256']` pin on both legacy verifiers), `package.json`/`package-lock.json` (explicit `jsonwebtoken`/`@types/jsonwebtoken`), `.env.example` (new `OAUTH_*` variables), `docs/KEY_MANAGEMENT_ARCHITECTURE.md`, `docs/EXTERNAL_API_TRUST_BOUNDARY.md`, `docs/TOKEN_ARCHITECTURE.md`, `docs/TOKEN_AND_SCOPE_ARCHITECTURE.md`, `docs/PHASE_2D_ARCHITECTURE.md` (implementation-status notes only, no architectural decision altered).

## Database

```text
Database changes: 0
Migration changes: 0
```
Key material is config/in-memory only, per the phase's own explicit preference — no table was needed or created.

## TravelOS Isolation

```text
Files changed: 0
Dependencies changed: 0
DB changed: 0
Migrations changed: 0
Git history changed: 0
```

## Deferred Scope (explicitly confirmed NOT implemented)

`/authorize`, `/token`, `/userinfo`, `/revoke`, `/introspect`, `/.well-known/openid-configuration`; Client Credentials grant; `ServiceAccount`/`Application` OAuth-client persistence (`grantTypes`/`allowedScopes`/`audiences` columns); Token Exchange; impersonation; scopes *enforcement* (the claim exists on `ExternalTokenClaims` but nothing yet issues or checks it against a real permission); dynamic client registration; device flow; refresh-token changes (the legacy refresh mechanism is untouched; no external refresh token exists yet); MFA; SAML; SCIM; social login; developer portal; SDKs; API marketplace; billing; subscriptions; metering.

## Known Issues

- **Low**: `SigningKeyService`'s in-memory key store is per-process — a multi-instance deployment would need every instance configured with the identical `OAUTH_PRIVATE_KEY` (already the intended model; env-var-based configuration is inherently shareable across instances, unlike an auto-generated dev key, which is deliberately per-process and ephemeral).
- **Low**: No automated key-rotation *execution* (generating a new key, publishing it, cutting signing over, then retiring the old one) exists — `OAUTH_RETIRED_PUBLIC_KEYS` provides the mechanism's data shape; performing an actual rotation today is a manual operator procedure (updating both env vars).
- **Low**: `ExternalTokenService.sign()`/`.verify()` have no HTTP endpoint calling them yet — by design (this phase's explicit scope boundary), but worth naming so it's not mistaken for an oversight.

## Final Decision

```text
PHASE 2D.1 PASS — READY FOR PHASE 2D.2
```
