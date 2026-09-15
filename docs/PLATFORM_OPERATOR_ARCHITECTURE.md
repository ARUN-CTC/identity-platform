# Platform Operator Architecture

Phase 2B.1. See `docs/adr/ADR-010-platform-operator-security-boundary.md` for the decision record this document expands on, `docs/PLATFORM_OPERATOR_LIFECYCLE.md` for lifecycle detail, and `docs/PLATFORM_OPERATOR_AUTHORIZATION.md` for the permission model.

## 1. What exactly is a Platform Operator?

A Platform Operator is a global Identity (`security_user`) additionally holding platform-level authority — the ability to manage entities that don't belong to any Tenant (Products, Applications, other Platform Operators, and platform-scoped audit visibility). It is not a role, not a permission, and not a property derived from any Organization Membership or tenant-scoped grant. It is a distinct fact about a global Identity, recorded in its own table.

```text
Global Identity (security_user)
      │
      ├── Organization Memberships → Organization Roles → Organization-scoped Permissions
      │        (docs/IDENTITY_DOMAIN_MODEL.md, docs/PHASE_2A.md)
      │
      └── Platform Operator Authority → Platform Permissions
               (this document)
```

These two trees never intersect. A Platform Operator may hold zero Memberships (Security Invariant #4); a Tenant Admin holds zero platform authority unless someone with `PLATFORM_OPERATOR_MANAGE` explicitly grants it (Security Invariant #3).

## 2. How is a Platform Operator represented?

`platform_operator` — one row per global Identity that has ever been granted platform authority, `1:1` with `security_user` via a unique `user_id`, `status` (`ACTIVE`/`DISABLED`), no `tenant_id`, no RLS (`docs/TRUST_BOUNDARY.md`'s "platform-level entity" determination, applied here too). Its permissions live in a separate table, `platform_operator_permission` (direct grants — see §"Why direct grants, not roles" below), not embedded as a column or JSON blob, so they remain individually auditable and constrainable.

## 3. How does a Platform Operator authenticate?

Through the same credential infrastructure as every tenant user — Argon2id password hashing, the same `security_user.failedLoginCount`/`lockedUntil` brute-force counters, the same refresh-token-rotation-with-reuse-detection pattern — but through a **separate endpoint and claims shape**: `POST /v1/platform/auth/login`, taking only `{email, password}` — no `tenantCode`, because a Platform Operator may have no Tenant to name. This had to be a genuinely separate login path, not a flag on the existing one: the existing `/v1/auth/login` always resolves a Tenant and checks Membership before issuing a token, a check a zero-Membership Platform Operator can never pass. See `docs/PLATFORM_OPERATOR_LIFECYCLE.md` for the full request/response contract of every platform-auth endpoint.

## 4. How is Platform Operator authorization evaluated?

`PlatformPermissionsGuard` resolves `@RequirePlatformPermissions(...)` against `platform_operator_permission` only — it does not, and structurally cannot, consult `security_user_role`/`Membership`. See `docs/PLATFORM_OPERATOR_AUTHORIZATION.md` for the permission catalog and the grant-ceiling rule that governs who may grant what to whom.

## 5. How is a Platform Operator created?

`POST /v1/platform/operators`, requiring `PLATFORM_OPERATOR_MANAGE`. Deliberately requires the target `email` to already resolve to an existing, already-activated global Identity (one with a password already set) — this endpoint does not provision a brand-new Identity the way `UsersService.create()`'s tenant-invite flow does. Rationale: the existing invitation mechanism (`security_user_invitation_token`) is Organization-scoped (Phase 2A) and has no home for a principal with no Organization at all; and a principal this sensitive should already be a known, credentialed account before being handed platform authority, not provisioned by the same call that grants it. If the target person doesn't have an account yet, they get one first (however your organization normally does that — a tenant invite, self-registration, whatever exists at the time), then get promoted. Not a limitation to be "fixed" casually — a deliberate simplification, recorded as a known item in `docs/PHASE_2B1.md` rather than solved by inventing a second, parallel invitation flow in this already-large phase.

## 6. How is the initial Platform Operator bootstrapped?

Two paths, by environment:

- **Dev/test**: `database/seeds/005_bootstrap_platform_operator.sql` — a placeholder account (`platform-operator@example.com`), same dev-only Argon2id hash convention this project already uses for its dev tenant admin, clearly labeled as such, granted every platform permission.
- **Production**: `database/scripts/bootstrap-platform-operator.ts` (`npm run platform:bootstrap`), which reads `PLATFORM_OPERATOR_EMAIL`/`PLATFORM_OPERATOR_PASSWORD` from the environment — never hardcoded, never committed — hashes the password itself, and creates the account + grants every platform permission. **Idempotent**: if an `ACTIVE` Platform Operator already exists anywhere, it prints a message and creates nothing, rather than creating a second one or erroring. Verified directly (`docs/PHASE_2B1.md`'s test-coverage section): running it twice in a row is a safe no-op the second time; running it against a database with zero operators creates exactly one.

```text
fresh database
    ↓ database/scripts/build-schema.sh + seed.sh  (dev)
    ↓ or: migration + npm run platform:bootstrap  (production)
initial Platform Operator, ACTIVE, holding every platform permission
```

## 7. How is a Platform Operator disabled/revoked?

`PATCH /v1/platform/operators/:id` with `{status: 'DISABLED'}`, requiring `PLATFORM_OPERATOR_MANAGE`. Disabling immediately: (a) revokes every `platform_operator_session`/`platform_operator_refresh_token` this operator holds, and (b) is itself checked live on every subsequent request by `PlatformJwtAuthGuard` (see §"Token security" below) — both halves matter, since either alone leaves a gap (session revocation alone doesn't stop an already-issued access token; a guard check alone still leaves stale sessions in the table). Reactivation is the same endpoint with `{status: 'ACTIVE'}`. No delete endpoint exists — see `docs/PLATFORM_OPERATOR_LIFECYCLE.md`.

## 8. Can a Platform Operator belong to organizations?

Yes, incidentally — nothing prevents the same global Identity from also holding ordinary Organization Memberships (they're independent facts about the same Identity), but nothing about becoming a Platform Operator creates one, and nothing about the login/authorization paths for either ever crosses into the other. Verified directly: `tests/phase2b1-platform-operator.e2e-spec.ts`, "a Platform Operator has zero Organization Memberships and is not automatically added to any organization."

## 9. Can an organization administrator become a Platform Operator?

Only if a Platform Operator holding `PLATFORM_OPERATOR_MANAGE` explicitly grants it via `POST /v1/platform/operators` — being a Tenant Admin (or even `SUPER_ADMIN`) confers nothing automatically. Verified directly: `tests/phase2b1-platform-operator.e2e-spec.ts`, "a tenant SUPER_ADMIN holds no Platform Operator record and cannot reach any platform endpoint."

## 10. Can a Platform Operator access tenant data?

**Not through platform authority.** `platform_operator`/`platform_operator_permission`/`platform_operator_session` carry no tenant context whatsoever, and `PlatformJwtAuthGuard` never populates `RequestContextService.tenantId` — every tenant-scoped route (anything not under `/platform/*`) rejects a Platform Operator's token outright, at the *authentication* layer (the global `JwtAuthGuard` cannot even resolve a `security_session` for it — see `docs/TRUST_BOUNDARY.md`-style reasoning applied to sessions instead of RLS). If a Platform Operator also happens to hold an ordinary Membership (§8), they can access that tenant's data exactly the way any other member would — through a normal tenant login, with a normal tenant token, subject to normal Membership/role/permission checks. Platform authority itself grants no shortcut into tenant data, ever. `identity_app`'s `NOBYPASSRLS` status is completely unaffected by any of this — nothing in Phase 2B.1 touches how the application connects to Postgres.

## 11. How does RLS behave for Platform Operators?

`platform_operator`, `platform_operator_permission`, `platform_operator_session`, `platform_operator_refresh_token` carry no `tenant_id` and have **no RLS at all** — the same reasoning already applied to `product`/`application` (`docs/TRUST_BOUNDARY.md`): a platform-level entity has no single tenant to filter by. Every tenant-scoped table's RLS is completely unchanged. `security_permission` gains a `platform_only` flag and a trigger-enforced invariant (§"Security invariants" below) — this is additive, not a change to RLS itself.

## 12. How are platform-level audit events attributed?

`security_event.scope` (`'TENANT'` default, `'PLATFORM'` for these) plus a corrected RLS policy that allows a genuinely `NULL` `tenant_id` to be *written* through the ordinary application connection when `scope = 'PLATFORM'` (the old policy only ever allowed a NULL-tenant row to be read, never written, by the app role — see `database/shared/002_functions.sql`'s own comment on `apply_tenant_rls_nullable`, and `docs/PHASE_2B.md`'s Known Issues, now resolved). `SecurityEventsService.recordPlatformEvent()` is the call site convention: `actorUserId` (a `security_user.id`, never a `platform_operator.id` — see the bug this exact confusion caused, fixed during this phase's own testing), `eventType`, `resourceType`/`resourceId`, `metadata` — never a `tenantId`. Verified directly: every `PRODUCT_*`/`APPLICATION_*`/`PLATFORM_OPERATOR_*`/`PLATFORM_LOGIN_*` event has `tenantId === null`, `scope === 'PLATFORM'`, queryable via `GET /v1/platform/audit-events` (gated by `PLATFORM_SECURITY_VIEW`).

## 13. How are concurrent changes handled?

The one genuinely concurrency-sensitive invariant — never let the count of `ACTIVE` Platform Operators reach zero — is enforced in the database via `pg_advisory_xact_lock` inside a trigger on `platform_operator` (`BEFORE UPDATE OR DELETE`), not solely by an application-level `COUNT(*)` check a race could slip past. See `docs/PLATFORM_OPERATOR_LIFECYCLE.md` §"Last-active-operator protection" for the exact mechanism and its test coverage (`tests/phase2b1-platform-operator.e2e-spec.ts` fires concurrent disable attempts directly at the database and asserts the active count never reaches zero). Duplicate-operator-creation for the same email is prevented by `platform_operator.user_id`'s own `UNIQUE` constraint — a race there resolves to exactly one success and one constraint-violation-turned-409, deterministically, at the database level.

## 14. What happens if the operator is disabled while sessions/tokens exist?

**Token security, Scenario A** (brief §11): an operator logs in, is then disabled — their already-issued access token remains cryptographically valid (a stateless JWT can't be revoked by signature alone) but is rejected on the very next request, because `PlatformJwtAuthGuard` re-checks the operator's live `status` on *every* request, not only at login (mirroring `JwtAuthGuard`'s own session-liveness re-check for tenant tokens). Their refresh token is also immediately, explicitly revoked as part of the disable operation itself (`PlatformOperatorsService.setStatus()`), so the refresh path fails even faster than "wait for the next access-token expiry." Both halves are tested directly (`tests/phase2b1-platform-operator.e2e-spec.ts`, "a valid access token issued before disablement stops working on the very next request").

## 15. How do existing SUPER_ADMIN records migrate?

See `docs/adr/ADR-010-platform-operator-security-boundary.md`, "SUPER_ADMIN migration," and `docs/PHASE_2B1.md` for the exact migration SQL and its test coverage (run against a database simulating a genuine pre-2B.1 state with a real `SUPER_ADMIN` assignment, not merely a fresh bootstrap).

## 16. How do we prevent privilege escalation?

Three independent mechanisms, not one: (a) the grant-ceiling rule — an operator may only grant a platform permission code they themselves already hold, checked server-side on every grant, never trusting a client-supplied permission list (`docs/PLATFORM_OPERATOR_AUTHORIZATION.md`); (b) `security_permission.platform_only` plus the database trigger rejecting a platform-only code ever being attached to a tenant-scoped role, closing the "smuggle platform authority in through a broad tenant role" path at the schema level; (c) `PlatformJwtAuthGuard`/`PlatformPermissionsGuard` trust nothing from the client except a verified, signed bearer token — no request body/header/query field is ever treated as an authorization claim (client-supplied `operatorId`s, permission codes, etc. are always re-validated against the database, never taken at face value).

## 17. How do we prevent cross-tenant authorization bypass?

Structurally, not by convention: Platform Operator authority has no tenant dimension to bypass in the first place (§10). Every tenant-scoped authorization mechanism (RLS, `Membership`, `security_user_role`, `OrganizationAccessService`) is completely unmodified by this phase — verified by the full pre-existing Phase 2A/2B e2e regression suite passing unchanged (`docs/PHASE_2B1.md`).

## 18. How does this prepare the platform for future OIDC/OAuth2/service authentication?

`docs/adr/ADR-007-oidc-oauth-strategy.md`'s phased path is unaffected — this phase adds a second, parallel *principal type* (Platform Operator) with its own login, not a new token/OAuth mechanism. When OIDC/OAuth2 eventually wraps this platform's authentication (`docs/adr/ADR-007`), both the tenant-user and Platform-Operator login paths become candidate "subjects" for whatever protocol layer gets added — neither is privileged over the other in that future design, and nothing here commits to how that will look. Service-to-service authentication (`docs/adr/ADR-006-service-authentication.md`, `ServiceAccount`) remains a distinct, still-unbuilt future entity that would reference an `Application`, not a `PlatformOperator` — a machine credential and an elevated-human credential are different things, deliberately not conflated here.

## Security invariants (restated, all enforced, all tested)

1. Platform authority is not an organization role — enforced structurally (`platform_operator` is not `security_role`) and at the database level (`platform_only` + trigger).
2. Organization membership does not grant platform authority — no code path derives one from the other.
3. Tenant admin does not automatically become Platform Operator — verified directly.
4. Platform Operator does not automatically become a member of every organization — verified directly.
5. Platform Operator does not automatically bypass tenant RLS — `identity_app` remains `NOBYPASSRLS`; nothing here changes that.
6. Disabled Platform Operators cannot continue privileged access — live status re-check + explicit session/token revocation, both tested.
7. Final active Platform Operator cannot accidentally be removed — DB-level trigger, concurrency-tested.
8. Platform-level audit events are not falsely attributed to a tenant — `scope`/`tenantId` fixed and tested.
9. JWT claims cannot be used by clients to self-grant platform authority — every claim is server-issued and re-verified against the database on every request; nothing in a request body is trusted as an authorization fact.
10. Tenant IDs and organization IDs supplied by clients cannot bypass authorization — unchanged from Phase 2A/2B (this phase touches none of that machinery).
11. All privileged operations are auditable — every lifecycle/grant/login event is recorded.
12. Platform authorization is deny-by-default — `PlatformPermissionsGuard` requires an explicit grant for every `@RequirePlatformPermissions`-decorated route; nothing is allowed by omission.
13. TravelOS remains untouched — verified (`docs/PHASE_2B1.md`, "TravelOS Verification").
