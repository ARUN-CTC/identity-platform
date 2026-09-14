# Phase 2D.12 — API / Security Contract Freeze & Release Baseline

## Objective

Freeze the Identity Platform's external contract (v1) before external product adoption begins (Phase 2E). A freeze/documentation/release-baseline phase — no protocol redesign, no new business logic. See `docs/API_SECURITY_CONTRACT_FREEZE.md`, `docs/IDENTITY_PLATFORM_V1_RELEASE_BASELINE.md`.

## What was produced

- **`docs/API_SECURITY_CONTRACT_FREEZE.md`** — the central freeze declaration: 15 contract domains marked FROZEN, the frozen security-invariant list, the forbidden-contract-change list, the versioning/change-control policy, and the authoritative artifact index.
- **`docs/IDENTITY_PLATFORM_V1_RELEASE_BASELINE.md`** — release identity, supported protocols/grants/token/principal types, operational requirements, known limitations, compatibility/rollback policy, the full 9-migration database baseline, and a 27-item release checklist (every item PASS/PARTIAL/DEFERRED with cited evidence, none marked PASS without it).
- **`docs/contracts/identity-api-v1.json`** — a REAL OpenAPI 3 document (79 documented paths), generated directly from the running application (`database/scripts/export-openapi-contract.ts`) rather than hand-maintained — cannot silently drift from the actual routes.
- **`docs/contracts/access-token-claims-v1.schema.json`**, **`id-token-claims-v1.schema.json`**, **`principal-contract-v1.schema.json`** — JSON Schema for the three stable claim/principal shapes, each naming required/optional/forbidden fields and their security significance.
- **`docs/contracts/error-contract-v1.json`** — the complete bearer-token and token-endpoint error vocabularies with HTTP status and compatibility rules, drift-guarded against the real `ResourceServerAuthError`/`OAuthTokenError` classes by a new spec test.
- **Threat model freeze** (`docs/PHASE_2D_THREAT_MODEL.md` new section) — all 36 existing threats classified MITIGATED (33) or ACCEPTED (3: #9, #12, #21) — zero DEFERRED, zero silently dropped.

## Architectural decisions (freeze, not redesign)

- **No breaking change was found necessary.** A full review of every contract domain confirmed the existing implementation already satisfies the brief's own frozen-invariant list — Phase 2D.9/2D.10/2D.11 already did the hardening/contract/production-readiness work this freeze formalizes.
- **`AllExceptionsFilter` must never be globally registered** — reconfirmed from Phase 2D.11, now added to the explicit forbidden-contract-changes list (`docs/API_SECURITY_CONTRACT_FREEZE.md` §5) so a future phase does not rediscover this the hard way.
- **One artifact per contract, no duplicates** — the OpenAPI document is the sole HTTP-route authority; the JSON Schemas are the sole claim-shape authority; the error-contract JSON is the sole error-vocabulary authority. No YAML restating what the generated OpenAPI document already covers was created, avoiding the "duplicate conflicting definitions" the brief explicitly warns against.

## Final security review (manual source review, brief §34)

Performed this phase, on top of every prior phase's own review: `apply_tenant_rls`/`apply_tenant_rls_nullable` (`database/shared/002_functions.sql`) — confirmed both `USING` and `WITH CHECK` clauses correctly reference `current_tenant_id()`, no bypass path. Re-confirmed (Phase 2D.11's own live-database check, re-verified here) `identity_app` remains `NOBYPASSRLS`. Every guard/service already reviewed in Phase 2D.9-2D.11 was not re-read line-by-line again this phase (no new finding would be expected from doing so on unchanged code) — this phase's own review focused on what could plausibly have changed: the new contract artifacts and their drift guards.

## Tests

```text
Unit:        277/277 PASS (271 pre-existing + 6 new: src/contracts/contract-artifacts.spec.ts) — exit code 0
E2E:         325/325 PASS (Phase 2D.11's count, unmodified — zero new e2e file this phase) — exit code 0
API Contract: 6 tests (src/contracts/contract-artifacts.spec.ts) — OpenAPI artifact freshness + error-contract drift guard
Security:    the full existing Phase 2D.1-2D.11 regression suite, re-run, re-verifying every frozen invariant in docs/API_SECURITY_CONTRACT_FREEZE.md §4
Regression:  100% of every prior phase's suite, unmodified
Build:       PASS (nest build, exit 0)
Typecheck:   PASS (tsc --noEmit, exit 0)
Prisma:      VALID (npx prisma validate); zero diff in database/prisma/schema/
```

## Database

```text
DB changes: 0
Migration: none
```

## TravelOS Isolation

```text
Files: 0   Dependencies: 0   DB: 0   Migrations: 0   Git history: 0
```

## Known Issues

Carried forward, unresolved, and explicitly not Critical/High (no tenant-isolation/authentication/authorization defect):
- **Medium**: no application Dockerfile (Phase 2D.11, unresolved).
- **Medium**: `ProductsService`/`UsersService` P2002 fixes (Phase 2D.11) remain uncommitted (pre-existing unrelated dirty files) — the fixes are real, verified, and present in the working tree, just not yet part of any commit. This phase does not attempt to resolve that pre-existing repository-hygiene condition, which predates this phase and several others.
- **Low**: no distributed rate-limit backend, no metrics exporter, no live cross-process entitlement-check endpoint — all previously documented, all unchanged.

## Deferred Scope

MFA, Passkeys, SAML, Dynamic Client Registration, Device Authorization Grant, Token Exchange, Impersonation, token forwarding, advanced consent management, pairwise subjects, ACR/AMR, refresh-token redesign, SDK implementations, billing, metering, organization-level product subscriptions, product-specific IAM, TravelOS runtime integration.

## Git

```text
Previous HEAD: 4d25f4d (chore(identity): harden production readiness)
```

Commit created at the end of this phase containing only Phase 2D.12 files — see the final report for the exact SHA.

## Release Tag

See the final report §I for whether `identity-platform-v1.0.0` was created, and if not, the exact command documented as the release instruction.

## Final Decision

```text
PHASE 2D.12 — PASS
```
