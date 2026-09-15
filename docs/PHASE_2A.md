# Phase 2A — Global Identity & Membership Migration

## Objective

Implement the one approved Phase 2 architecture decision that everything else in the Phase 2 plan depends on: move `security_user` from a per-tenant identity to a global Identity, and introduce `Membership` as the entity that actually represents "this Identity belongs to this Organization/Tenant" (`docs/IDENTITY_DOMAIN_MODEL.md` §2.1, `docs/adr/ADR-002-tenant-organization-model.md`). Nothing else from the Phase 2 plan is implemented here — see `docs/PHASE_2_IMPLEMENTATION_PLAN.md`'s Phase 2B onward, all still ahead of this work.

## Before model

See `docs/PHASE_2A_BEFORE_SCHEMA.md` for the full table-by-table capture. In one sentence: `security_user.tenant_id` was required and part of the row's own uniqueness — a user could not exist independent of exactly one tenant.

## After model

```text
                     Identity (security_user, global)
                        │
             ┌──────────┴──────────┐
             │                     │
        Membership A          Membership B
       (tenant/org/status)   (tenant/org/status)
             │                     │
             ▼                     ▼
       Organization A        Organization B
             │                     │
             ▼                     ▼
     security_user_role      security_user_role
     (role grants, per       (role grants, per
      tenant+org as before)   tenant+org as before)
```

`security_user`: no `tenant_id` column, no RLS, globally unique `email`. `membership`: new table — `(tenant_id [denormalized], organization_id, user_id, status)`, `UNIQUE(user_id, organization_id)`, RLS via `apply_tenant_rls` (unchanged mechanism, new table). `security_user_role`: unchanged shape; its `user_id` now points at a global Identity, and a grant is only *effective* when a corresponding ACTIVE Membership exists (enforced in `UserRolesRepository`, not a new DB constraint — see "Known limitations"). `security_user_invitation_token`: gained a required `organization_id` — an invitation now targets one Membership, not "a tenant" in the abstract.

## Database changes

- `database/ddl/003_security.sql`: `security_user` — dropped `tenant_id` (column, FK, index, old unique constraint), added `UNIQUE(email)`, dropped the `apply_tenant_rls` call. `security_user_role` — comment-only (semantics changed, columns didn't). `security_user_invitation_token` — added `organization_id UUID NOT NULL REFERENCES organization(id)` + index.
- `database/ddl/004_membership.sql` (new): the `membership` table, its indexes, its own audit-fields-only trigger (not the full `apply_standard_triggers` — see below), and `apply_tenant_rls('membership')`.
- `database/prisma/schema/security.prisma`, `tenant.prisma`, `organization.prisma`: mirrored the above (new `Membership` model; `SecurityUser` loses `tenantId`/`tenant`; `Tenant`/`Organization` gain a `memberships` back-relation; `SecurityUserInvitationToken` gains `organizationId`/`organization`).
- `database/seeds/003_bootstrap_dev_tenant.sql`: rewritten — the DEV admin user insert no longer sets `tenant_id`; a `membership` row is inserted explicitly; the `security_user_role` insert resolves the tenant by a direct join instead of reading `security_user.tenant_id` (which no longer exists). As a byproduct, this also fixes a latent Phase 1 bug: the old seed's `ON CONFLICT (tenant_id, email) WHERE deleted_at IS NULL` never actually matched the table's real constraint (a plain `UNIQUE(tenant_id, email)`, no partial predicate) — re-running the seed against an already-seeded database would have thrown, not silently no-op'd. The new `ON CONFLICT (email) DO NOTHING` matches the new, actual constraint.

## Membership uniqueness

**Decision: a plain `UNIQUE(user_id, organization_id)`, not a partial index scoped by status.** A user has at most one Membership row per organization, ever — status transitions (`INVITED → ACTIVE → SUSPENDED`, or reactivating a `REMOVED` membership) reuse the same row via `UPDATE`, never a second `INSERT`. This was a genuine design choice (Step 5 of the Phase 2A brief specifically flagged it): a partial-unique-by-status design (e.g., unique only among non-REMOVED rows, allowing a fresh row after removal) was considered and rejected — it would let removing and re-adding the same user to the same organization accumulate multiple historical rows with no way to enforce "at most one *active* relationship" without the exact same kind of predicate anyway, for no benefit over just toggling one row's `status`. The membership table's `MembershipsRepository.setStatus()` always operates on the one existing row.

## RLS changes

- `security_user`: RLS **removed**. Not weakened — removed on principle, because RLS in this codebase is a `tenant_id`-column mechanism and a global Identity has no single `tenant_id` to filter by. This mirrors the precedent `security_permission` already set for itself ("global catalog ... no RLS"), applied to identity rows instead of permission rows.
- `membership`: RLS **added**, via the same `apply_tenant_rls` procedure every other tenant-scoped table already used — no new mechanism, no weakening.
- Every other table's RLS policy is byte-for-byte unchanged.

### Global Identity RLS posture — what actually enforces the tenant boundary now

With `security_user` outside RLS, "can tenant A's admin see user X" is enforced in application code, not the database, for that one table. Concretely: `UsersRepository.findMany()`/`findById()` now filter via `memberships: { some: { tenantId, status: { not: 'REMOVED' } } }` — a Prisma-level join against `membership`, which *is* still RLS-protected, so a query attempting to bypass the explicit filter would still have the underlying membership rows invisible cross-tenant. This is belt-and-suspenders by construction (the explicit filter is the primary control; membership's own RLS is the backstop), and it is exactly what the e2e test suite (`tests/phase2a-membership.e2e-spec.ts`, "RLS isolation" describe block) verifies directly against the real database, not mocked.

## Application changes

- **New module**: `src/modules/memberships/` — `MembershipsRepository`, `MembershipsService`, `MembershipsController` (`GET /organizations/:organizationId/members`, `PATCH /organizations/:organizationId/members/:userId`).
- **`UsersRepository`/`UsersService`**: global email/id lookups (`findByEmail`, `findByIdGlobal`) alongside tenant-membership-gated ones (`findByIdWithTenantMembership`/`findAuthRecordInTenant`); `create()` now requires `organizationId` and either creates a brand-new global Identity + `INVITED` Membership, or attaches an existing (already-activated) global Identity to a new Membership directly as `ACTIVE`, skipping the invitation-accept step (`docs/IDENTITY_DOMAIN_MODEL.md` §2.1's reuse case).
- **`UserRolesRepository.resolveGrants()`**: now checks Membership before resolving any grant — no ACTIVE membership anywhere in the tenant means no grants resolve at all; an organization-scoped grant only resolves when an ACTIVE membership exists in that exact organization. This is the single most important behavioral change in this phase — see "Membership is the authorization gate" below.
- **`UserRolesService.assign()`**: now requires the grantee to already hold the membership the grant would be scoped to (`assertGranteeHasMembership`), rejecting a grant that could never resolve to anything, with a clear error, at write time rather than silently accepting dead data.
- **`UserInvitationsService`**: invitations are organization-scoped end to end (token, resend, accept); `acceptInvitation()` is safe against a global Identity accepting a *second* pending invitation after already activating via a first one (only sets a password if one doesn't already exist).
- **`AuthenticationService`**: `login()` resolves the Identity globally by email, then explicitly checks Membership in the requested tenant (same generic failure as "no such email" — no account-enumeration signal); `refresh()` now denies (and revokes) a session whose Membership was revoked since the token was issued; `forgotPassword()`/`resetPassword()`/`changePassword()` updated to the same lookup pattern.

### Membership is the authorization gate

The core invariant this phase establishes, stated once: **a `security_user_role` row is necessary but not sufficient for a grant to be effective — an ACTIVE `membership` row must also exist, in the same tenant (for any grant) and in the same organization specifically (for an organization-scoped grant).** This is what makes removing/suspending a Membership actually revoke access, without needing to hunt down and delete every role-grant row that happens to reference that organization.

## Test coverage

`tests/phase2a-membership.e2e-spec.ts` — 10 tests against the real database (not mocked), covering: a tenant-wide grant working end to end (login → `/auth/me` → an admin-only write); the same global Identity being denied login to a tenant it has no membership in; one Identity holding an organization-scoped grant in one tenant and a tenant-wide grant in another, resolved independently and correctly (`UserRolesService.resolveGrants()` exercised directly, plus HTTP-level authenticated-but-under-permissioned behavior); removing a membership denying both a fresh login *and* an already-issued refresh token; suspending a membership doing the same; the full invitation lifecycle (brand-new email → `INVITED` membership → accept → `ACTIVE`); an already-active global Identity being reused (not duplicated) when invited into a second organization, with same-password login into both tenants proven; a client-supplied `organizationId` for a role grant being re-validated server-side even when the target user is otherwise visible (member of a sibling organization); a foreign-tenant `organizationId` 404ing rather than leaking existence; and direct RLS verification that a tenant context can only ever see its own organizations/memberships. All 10 pass, alongside the pre-existing unit test suite (3/3) and the Phase 1 health e2e test (1/1) — full regression run: `docs/PHASE_2A_ROLLBACK.md` records the exact commands.

## Seed data

`database/seeds/003_bootstrap_dev_tenant.sql` rewritten per above — placeholder dev-only data only (`admin@example.com`), no production/real data touched, consistent with Phase 1's own placeholder-seed convention.

## Backward compatibility

Breaking changes, each deliberate and documented here per the brief's own Step 22 requirement (not silently introduced):

1. **`CreateUserDto.organizationId` is now required.** Creating a user was always implicitly tenant-scoped; it is now explicitly organization-scoped, because Membership requires an organization. There is no reasonable default to infer (a tenant is not required to have exactly one organization).
2. **`POST /users/:id/resend-invitation` now requires `{ organizationId }` in the body.** A global Identity can have more than one pending invitation at once, into different organizations — resending needs to say which one.
3. **`LoginDto.tenantCode` keeps its exact shape but not its original rationale** — no client-facing change, but its doc comment is updated (`docs/PHASE_2A.md`'s own login flow above, `src/modules/authentication/dto/login.dto.ts`).
4. **`GET /users`/`GET /users/:id` visibility changed from "tenant_id column match" to "has a non-REMOVED membership in this tenant"** — behaviorally equivalent for every Phase 1 dev/seed scenario (one user, one tenant, one membership), and the only change visible to a genuinely multi-tenant Identity (which could not exist before this phase).

Everything else — every existing endpoint's request/response shape, every session/token mechanism, every RBAC/grant-ceiling rule — is unchanged.

## Known limitations (documented, not fixed here — Step 24's "stop and document" instruction, applied)

1. **`security_user_role` has no DB-level constraint tying its `organization_id`'s tenant to its own `tenant_id`, nor one requiring a corresponding Membership to exist.** Both are enforced in `UserRolesRepository`/`UserRolesService` application code only. A DB trigger enforcing this was considered and deliberately not added in Phase 2A, to avoid duplicating the same invariant in two places for a mechanism (RBAC) the brief explicitly said not to redesign this phase.
2. **`UsersService.activate()/suspend()/deactivate()` act on the global Identity, affecting every Tenant/Organization it has a Membership in — not just the calling admin's own tenant.** This is a real, undecided product question (should a consultant be suspendable from one tenant without losing access to another?) that depends on how a "suspended in Tenant A, active in Tenant B" Identity should behave at login — exactly the kind of question `docs/ORGANIZATION_CONTEXT.md` and Phase 2C are scoped to resolve, not something to guess at here. `MembershipsController`'s status endpoint (`PATCH /organizations/:organizationId/members/:userId`) is the correctly tenant-scoped lever available today; documented as the recommended mechanism in the meantime (see that document's own note on this).
3. **`AuthenticationService.refresh()`'s membership-revocation check adds one more DB round-trip to every refresh** (`findAuthRecordInTenant`, a join through `membership`) — a deliberate correctness-over-micro-latency choice (Step 21's negative-testing requirement), not expected to matter at Phase 2A's scale, flagged in case a future phase's load characteristics disagree.
4. **A very rare concurrent-accept race**: if the same not-yet-activated global Identity has two pending invitations (different organizations) and both are accepted at nearly the same instant, `acceptInvitation()`'s password-setting step has the same theoretical TOCTOU window Phase 1's original single-token design never had to consider (Phase 1 could only ever have one pending invitation per user). Judged acceptable — an extremely narrow window, and the failure mode (retry the accept) is benign, not a security hole.

## Deferred work

Everything in `docs/PHASE_2_IMPLEMENTATION_PLAN.md` from Phase 2B onward: product/application registration, organization-context switching (the `organization_id` token claim, `POST /v1/auth/context/switch`), service-to-service authentication, OIDC/OAuth2, MFA, enterprise federation, SDKs, production hardening. None of it was touched, per this phase's explicit scope control.

## Rollback strategy

See `docs/PHASE_2A_ROLLBACK.md`.
