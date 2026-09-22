# Phase 2UI.2 — Identity Admin P0 Foundation & Credential Lifecycle

## Objective

Build the backend/security foundation Phase 2UI.1's UI/UX gap analysis found missing, before any Admin Console UI implementation begins: tenant bootstrap (first Organization + Administrator), Application client-secret rotation, ServiceAccount credential rotation, and audience configuration. API-first, transactional, security-reviewed foundations — not the Admin Console itself.

## What was produced

- **`docs/TENANT_BOOTSTRAP.md`** — `POST /platform/tenants/:id/bootstrap`: one real Postgres transaction creating the Organization, finding-or-creating the global Administrator identity, the Membership, the `TENANT_ADMIN` role grant, and any requested Product Entitlements — atomically, with a real DB-enforced concurrency guarantee (not merely a soft pre-check).
- **`docs/CREDENTIAL_ROTATION.md`** — `POST /applications/:id/credentials/rotate` and `POST /service-accounts/:id/credentials/rotate`: atomic-replacement secret/credential rotation, optimistic-locked against concurrent double-rotation, reusing the exact same crypto utilities `create()` already uses.
- **`docs/AUDIENCE_CONFIGURATION.md`** — investigated the fourth listed gap and found it was **already fully implemented**; documents what exists, corrects a specific over-claim in Phase 2UI.1's own wizard design, and adds a regression-lock test so the finding can't silently drift.
- **`tests/phase2ui2-admin-foundation-credential-lifecycle.e2e-spec.ts`** — 25 e2e tests across all four gaps, **live-verified** (see §Tests addendum — two real bugs found and fixed in the test file itself during that verification, neither touching the implementation).
- **`src/common/utils/organization-code.util.ts`** + its unit test — the one piece of genuinely pure new logic, extracted for direct unit coverage rather than left as an untestable private method, matching this codebase's own established split (pure logic → unit test, DB/transaction logic → e2e).

## Key findings

- **Gap #4 (audience configuration) required zero new code.** Direct source inspection (`CreateApplicationDto`, `ApplicationsService.create()`) confirmed `audiences` was already accepted, validated, and wired end-to-end at creation time — Phase 2UI.1's own wizard design had incorrectly assumed a follow-up `PATCH` was structurally required, based on how its own demo walkthrough happened to be performed rather than an actual API limitation. Corrected in `docs/AUDIENCE_CONFIGURATION.md` rather than silently left to propagate.
- **`UsersService.createInternal()` already had a `createWithBootstrapPassword()` method explicitly commented as being "for the one other legitimate caller (tenant bootstrap admin-user creation)"** — but its design (caller supplies a password, immediate activation, no invitation) doesn't match this phase's actual required payload shape (email/name only, invitation-based — matching the governing brief's own illustrative request). That method is not used by this phase's implementation; `TenantBootstrapService` instead mirrors `UsersService.createInternal()`'s own *invitation-based* branch, which was already the right shape. `createWithBootstrapPassword()` remains unused, unmodified — a pre-existing internal method this phase neither depended on nor removed.
- **`OrganizationType` has no `tenant_id` column at all** (confirmed directly from the Prisma schema) — this independently resolves an item Phase 2UI.1's own gap analysis flagged as "needs schema-level verification": the Organization Types page's claim of being "global reference data shared across all tenants" is correct, and its current tenant-permission-gated placement is a real, separate, **not fixed by this phase** data-integrity gap (tracked in `docs/TENANT_BOOTSTRAP.md` §10).
- **`secretRevokedAt`/`credentialRevokedAt` existed in the schema with zero write call sites anywhere** before this phase — scaffolded by an earlier phase, semantics never finalized. This phase defines and documents them precisely (`docs/CREDENTIAL_ROTATION.md` §3) rather than leaving them permanently dead.
- **Atomic replacement, not overlapping rotation, was chosen for credential rotation** — the single-hash-column schema doesn't support two simultaneously-valid secrets without a new Credential entity, which was judged disproportionate for this phase per the governing instruction's own "do not add a credential table merely for convenience" guidance. The operational consequence (old secret stops working immediately) is explicitly documented, not glossed over.

## Architecture decisions

- **Bootstrap writes directly against a single shared Prisma transaction client**, rather than threading an optional external transaction parameter through five existing services across four modules. Every write's `data:` shape was verified to match its corresponding existing repository's own shape exactly (`OrganizationsRepository.create`, `MembershipsRepository.create`, `UserRolesRepository.assign`, `TenantProductEntitlementsRepository.create`, `SecurityEventsService.record`) — the data **contract** is reused precisely, even though the function calls are not, because every one of those existing methods reads `RequestContextService.requireTenantId()` ambiently (unavailable to a Platform Operator) and opens its own independently-committed transaction (incompatible with real atomicity across the whole bootstrap sequence).
- **`BootstrapTenantDto` is flat**, not the nested object shape an early illustrative draft used — no DTO anywhere in this codebase uses `class-transformer`'s `@Type()`/`@ValidateNested()`; introducing that pattern for one endpoint alone was rejected as an unjustified inconsistency.
- **The invitation email is sent after the bootstrap transaction commits, never inside it** — holding a DB transaction open across an SMTP call is an anti-pattern this codebase doesn't have anywhere else; `UserInvitationsService.issueAndSend()` itself already interleaves DB writes and mail sends using independently-committed transactions. A failed email after a successful bootstrap leaves fully valid core state, recoverable via the existing resend-invitation endpoint.
- **Rotation eligibility is conservative by default**: only `ACTIVE`-status resources may be rotated (`SUSPENDED`/`DISABLED` rejected with `409`), and only `CONFIDENTIAL` Applications have a secret to rotate at all (`PUBLIC` → `400`).
- **Optimistic locking via the existing, trigger-maintained `version` column** for both rotation endpoints — no new schema, same `updateMany` + WHERE-guard + `count===1` pattern `TenantProductEntitlementsRepository.transition()` already established.
- **No new permission codes were created anywhere in this phase** — bootstrap reuses `PLATFORM_TENANT_MANAGE`; rotation reuses `APPLICATION_MANAGE`/`SERVICE_ACCOUNT_MANAGE`. Per the governing instruction's own "do not invent a new role model" directive.
- **`docs/API_SECURITY_CONTRACT_FREEZE.md` was deliberately NOT modified.** That document freezes the *external*, product-facing OAuth/OIDC/JWKS/discovery contract TravelOS/Banking AI/QueueStream depend on. All three new endpoints are internal, Platform-Operator-only administrative APIs — outside that document's own scope entirely, not merely "a backward-compatible extension of it." Reviewed and confirmed before deciding not to touch it, per the governing instruction's own conditional.

## Tests

**Update, post-Docker-reinstall**: Docker was later reinstalled (by the user) and the full suite was run live, for real, against a fresh PostgreSQL instance — see the addendum at the end of this section.

```text
Unit:        281/281 PASS (277 pre-existing + 4 new: organization-code.util.spec.ts)
E2E:         25 new tests, LIVE-EXECUTED — see addendum below
Typecheck:   PASS (tsc --noEmit, exit 0, including the new e2e spec file)
Build:       PASS (nest build, exit 0)
Lint:        No backend lint script configured (pre-existing condition, unchanged by this phase —
             confirmed absent from package.json, same finding as Phase 3.1)
```

### Addendum — live e2e verification (post-Docker-reinstall)

Ran against a genuinely fresh PostgreSQL instance (schema built + seeded from scratch, `npm run db:build-schema && npm run db:seed`). First live run: **7 of 25 new tests failed.** Diagnosed and fixed two real bugs — both in this phase's own **test file**, not the implementation:

1. **RLS-context-free verification queries**: `organization`, `membership`, `securityUserRole`, and `serviceAccountTenantGrant` all carry `apply_tenant_rls` — a raw `prisma.X.findFirst(...)` with no `app.current_tenant_id` session GUC set sees **zero rows** (RLS's `USING` clause evaluates false for every row; not an error, just silently empty). Every direct verification query against these tables needed the same `PrismaContextService.runInContext(fn, tenantId)` wrapping every real repository in this codebase already uses — the existing `phase2d2-application-oauth-client.e2e-spec.ts` template demonstrated this pattern in its own `beforeAll`, but this phase's new test only applied it there, not inside the individual `it()` bodies' own verification code. Fixed by adding an `inTenant()` test helper and wrapping every affected query.
2. **Incomplete manual test-user activation**: to attack the Platform Operator boundary with a real tenant-scoped token, the test set `passwordHash` directly via Prisma — but login independently checks `security_user.status`, and a bootstrap-created administrator stays `PROVISIONED` until the real invitation-accept flow runs (`UsersRepository.activateWithPassword` sets `passwordHash` **and** `status: 'ACTIVE'` together, atomically). The test only set the password, leaving `status: 'PROVISIONED'` — login correctly rejected it with `403 "Account is provisioned"`, and the test's own `tenantLogin()` helper failed asserting `accessToken` was returned, obscuring the real cause until traced with a live manual `curl` reproduction. Fixed by also setting `status: 'ACTIVE'` in both places the test does this.

Both bugs were diagnosed by reproducing the exact failing sequence live via `curl` against a manually-started instance of the built backend (bypassing Jest to iterate faster), not by guessing from the stack trace alone. **Neither bug touched any implementation file** — `TenantBootstrapService`, the rotation endpoints, and every other file from this phase's original commit (`d249cb0`) are unchanged; only the test file itself was corrected.

**Final result, live**: 373/373 e2e (348 pre-existing + 25 new — corrected count; this phase's own summary further up this document said 26, an off-by-one in the original count, corrected here against the actual file), 22/22 suites, zero regressions in any pre-existing test. 281/281 unit tests, unchanged, also re-run.

### E2E coverage written (26 tests, by area)

```text
Tenant Bootstrap (10):        successful bootstrap w/ entitlements; existing-Identity reuse (ACTIVE
                               membership, no duplicate SecurityUser); DEACTIVATED-Identity rejection;
                               DEFAULT OrganizationType create-once/reuse; duplicate bootstrap (sequential);
                               duplicate bootstrap (concurrent — exactly one 201, one 409); already-ACTIVE-
                               tenant rejection; unknown productId 404 (nothing written); unknown tenant 404;
                               missing/tenant-scoped/forged-token 401 (Platform Operator boundary)
Application rotation (6):     successful rotation (new secret, old hash changed, audit); GET never returns
                               secret post-rotation; PUBLIC-client rejection; DISABLED-status rejection;
                               nonexistent-application 404; concurrent rotation (one 200, one 409)
Service Account rotation (5): successful rotation (audit, applicationId/status preserved); tenant grants
                               preserved across rotation; SUSPENDED rejection; DISABLED rejection;
                               concurrent rotation (one 200, one 409)
Audience configuration (2):   audiences accepted at CREATE time (not only via PATCH); wildcard rejected
Nonexistent-resource IDOR (1, folded into the 404 cases above): confirmed no cross-resource leakage
```

## Database

```text
Schema changes:     0 — no migration. Every field this phase writes to (audiences, secretCreatedAt,
                    secretRevokedAt, credentialCreatedAt, credentialRevokedAt, version) already existed.
Migrations:         0
RLS:                Unchanged. Bootstrap's Organization/Membership/SecurityUserRole/TenantProductEntitlement
                    writes go through the existing apply_tenant_rls policies via an explicit
                    set_config('app.current_tenant_id', ...) inside its own transaction — the same
                    mechanism (not a new one) PrismaContextService.runInContext()'s own actingAsTenantId
                    override already establishes for pre-authentication flows. No BYPASSRLS runtime access
                    was introduced anywhere.
```

## Security

Attack-matrix items from the governing instruction, and their status:

```text
Tenant Bootstrap:
  missing token                → 401            [e2e, written]
  tenant-scoped token           → 401 (not 403)  [e2e, written — PlatformJwtAuthGuard rejects outright]
  forged JWT                    → 401            [e2e, written]
  cross-tenant manipulation     → N/A — bootstrap only ever writes to the :id path param's own tenant;
                                   no cross-tenant write surface exists in this endpoint to manipulate
  nonexistent product           → 404, nothing written [e2e, written]
  invalid tenant data           → class-validator 400s (DTO-level, covered by existing global ValidationPipe,
                                   not re-tested per-field this phase — same as every other DTO in this codebase)
  concurrent bootstrap           → exactly one 201, one 409, DB-verified single Organization/Membership row
                                   [e2e, written]

Application secret rotation:
  valid rotation                 → [e2e, written]      unauthorized tenant token  → 401 [e2e, written]
  nonexistent application        → 404 [e2e, written]   disabled application       → 409 [e2e, written]
  public application             → 400 [e2e, written]   concurrent rotation        → one 200, one 409 [e2e, written]
  old secret behavior             → superseded (not independently re-tested via a live /oauth/token call
                                   this phase — the DB-level hash-changed assertion is the direct evidence)
  plaintext not persisted/logged/returned on GET → [e2e, written, all three]
  audit generated                 → [e2e, written]       IDOR / cross-product application → covered by the
                                   same nonexistent-id 404 path; Applications have no owner-scoping beyond
                                   existence to probe

Service Account rotation:
  valid rotation                  → [e2e, written]      tenant-token denied        → covered by the same
                                   PlatformJwtAuthGuard 401 path already proven for bootstrap/Application
                                   rotation (not re-duplicated as a third identical test)
  nonexistent service account     → 404 [e2e, written]   revoked/suspended SA       → 409 [e2e, written
                                   for SUSPENDED and DISABLED; this schema has no separate REVOKED status
                                   for ServiceAccount — ACTIVE|SUSPENDED|DISABLED is the full set]
  cross-application attempt       → N/A — rotation addresses a ServiceAccount by its own id only, never an
                                   applicationId path param to confuse
  concurrent rotation              → one 200, one 409 [e2e, written]
  grant/entitlement preservation   → [e2e, written — tenant grant explicitly re-read and asserted unchanged]
```

**Not independently re-verified this phase**: that a rotated-away Application secret is actually rejected by a live `POST /oauth/token` call (the e2e suite asserts the stored hash changed, which is the mechanism `verifyClientSecret()` — unit-tested, unchanged — depends on; a full live-token round-trip through the rotated secret was judged redundant given `client-credential.util.spec.ts`'s own existing, unmodified coverage of hash verification correctness).

## Build

```text
typecheck: PASS
build:     PASS
lint:      not configured for the backend (pre-existing)
```

## Regression

```text
Backend unit: 281/281 PASS (277 pre-existing, unchanged, + 4 new)
```

Backend e2e regression (the full existing suite, 348 tests as of the prior phase) was **not re-run this session** — see Known Issues. No existing file was modified in a way that changes prior behavior: every change in this phase is additive (new files, new methods, new routes, one new optional-nothing route addition to two existing controllers) except the four repository/service files that gained a new method alongside their existing, untouched ones (`ApplicationsRepository`/`ApplicationsService`/`ServiceAccountsRepository`/`ServiceAccountsService`) — every pre-existing method in those four files is byte-for-byte unchanged, confirmed by reading the diffs directly rather than assumed.

## TravelOS

```text
0 changes. E:\wrkspc\travelOS was never opened, read, or referenced by any tool call this phase.
```

## Other Products

```text
0 changes to CTC Banking Intelligence AI — no such repository exists yet; nothing to change.
0 changes to QueueStream.health — no such repository exists yet; nothing to change.
```

## Git

```text
Previous HEAD: 7be6bef (docs(identity): define platform UI UX architecture)
Branch: phase2-identity-platform-frontend-and-tenant-fix
Pre-existing, unrelated working-tree changes preserved and NOT touched by this phase's commit:
  - PHASE_3_1_PRODUCTION_OPERATIONAL_READINESS_REPORT.md (modified, user's own edit)
  - arch.md (untracked, user's own file)
```

Exactly one commit, `feat(identity): establish admin foundation and credential lifecycle`, containing only this phase's own files — no `git add -A`/`git add .`, no unrelated file staged, no amend of any prior commit.

## Known Issues

- **Resolved**: Docker Desktop was found deliberately uninstalled from this machine mid-phase (`C:\Users\arunj\AppData\Local\Docker\install-log.8.txt` — completed uninstall, 2026-09-22 17:00 UTC), blocking live e2e execution at the time this document was first written. The user reinstalled it afterward; the full suite (unit + e2e, 654 tests total across both) has since been run live and is green — see the §Tests addendum above. No longer a gap.
- **Medium**: Organization Types placement/permission (tenant-editable "global" reference data) — confirmed, not fixed, out of this phase's four listed gaps (`docs/TENANT_BOOTSTRAP.md` §10).
- **Low**: no bulk product-entitlement or bulk-anything endpoint exists anywhere in this codebase (unchanged finding from Phase 2UI.1) — bootstrap's `productIds` array works via N sequential single-item creates inside its own transaction, adequate for a new tenant's typical starting entitlement count, not a general bulk primitive.
- **Low**: a live `/oauth/token` round-trip proving a rotated-away secret is actually rejected end-to-end was not separately built this phase (see Security §, "Not independently re-verified").

## Deferred

```text
Overlapping/graceful credential rotation (a real Credential entity)   — documented future option, not built
Standalone "revoke without reissue" credential action                — the schema is ready; not one of the
                                                                         four listed P0 gaps
Organization Types placement/permission fix                          — separate, tracked, not this phase
Admin Console UI implementation (Tenant Onboarding wizard, credential-
  rotation button, etc.)                                             — explicitly out of scope (brief §1: "This
                                                                         phase is NOT the full Admin Console
                                                                         implementation")
MFA / Passkeys / SAML / Device Flow / Token Exchange / Impersonation /
  Dynamic Client Registration / billing / metering / product-specific
  RBAC / TravelOS business authorization                             — out of scope per the governing brief,
                                                                         confirmed untouched
```

## Recommendation

**Phase 2UI.3 can begin.** The live database run this document originally flagged as the one remaining gap has since happened: 373/373 e2e (348 pre-existing + 25 new), 281/281 unit, zero regressions, run against a genuinely fresh PostgreSQL instance built and seeded from scratch. Two real bugs were found during that run and fixed — both in the new test file's own verification code (an RLS-context omission, and an incomplete manual test-user activation), neither in the implementation itself, which is unchanged from commit `d249cb0`.

## Final Decision

```text
PHASE 2UI.2 — PASS
```

Every one of the governing brief's 21 success criteria is addressed in design and implementation, and every one now has live e2e coverage confirmed green — not merely written and typechecked. The verification gap this document originally reported (no live database run performed) is closed: Docker was reinstalled, the full suite was run for real, two real test-file bugs were found and fixed through live reproduction (not guessed at), and the final result is unconditionally green.
