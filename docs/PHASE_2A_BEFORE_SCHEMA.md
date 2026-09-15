# Phase 2A — Before Schema

The exact database shape Phase 2A started from, captured before any change in this phase. Source: live inspection of `identity_platform_db` (via `psql \d`) cross-checked against `database/ddl/003_security.sql`/`002_organization.sql` and `database/prisma/schema/*.prisma` as they stood at the start of Phase 2A. See `docs/PHASE_2_BASELINE.md` for the narrative version of this same state.

## Tables and their relationships

| Table | PK | Notable FKs | Unique constraints | Notable indexes | RLS |
|---|---|---|---|---|---|
| `tenant` | `id` | — | `tenant_code` | `status` | None (it *is* the boundary) |
| `organization_type` | `id` | — | `type_code` | `type_name` | None (global catalog) |
| `organization` | `id` | `tenant_id → tenant`, `organization_type_id → organization_type` | `(tenant_id, organization_code)` | `tenant_id`, `organization_type_id`, `status` | `apply_tenant_rls` |
| `organization_unit_type` | `id` | — | `type_code` | `hierarchy_level` | None (global catalog) |
| `organization_unit` | `id` | `tenant_id`, `organization_id → organization`, `organization_unit_type_id`, `parent_unit_id → self` | `(organization_id, unit_code)` | tenant/org/type/parent/manager/status | `apply_tenant_rls` |
| `organization_unit_hierarchy` | composite `(ancestor_unit_id, descendant_unit_id)` | both `→ organization_unit`, `tenant_id` | — | descendant, depth, tenant | `apply_tenant_rls` |
| `security_user` | `id` | **`tenant_id → tenant` (required)** | **`(tenant_id, email)`** | `tenant_id` | `apply_tenant_rls` |
| `security_role` | `id` | `tenant_id → tenant` (nullable) | two partial: `(role_code) WHERE tenant_id IS NULL`, `(tenant_id, role_code) WHERE tenant_id IS NOT NULL` | `tenant_id` | `apply_tenant_rls_nullable` |
| `security_permission` | `id` | — | `permission_code` (global) | `resource` | None (global catalog) |
| `security_role_permission` | `id` | `role_id → security_role`, `permission_id → security_permission` | `(role_id, permission_id)` | role, permission | None (no `tenant_id` column) |
| `security_user_role` | `id` | `tenant_id`, `user_id → security_user`, `role_id → security_role`, `organization_id → organization` (nullable) | `(user_id, role_id, organization_id)` | tenant, user, role, organization | `apply_tenant_rls` |
| `security_session` | `id` | `tenant_id`, `user_id → security_user`, `organization_id → organization` (nullable, unused) | — | tenant, user, organization | `apply_tenant_rls` |
| `security_refresh_token` | `id` | `tenant_id`, `session_id → security_session`, `user_id → security_user` | `token_hash` | tenant, session, user | `apply_tenant_rls` |
| `security_password_reset_token` | `id` | `tenant_id`, `user_id → security_user` | `token_hash` | tenant, user | `apply_tenant_rls` |
| `security_user_invitation_token` | `id` | `tenant_id`, `user_id → security_user` | `token_hash` | tenant, user | `apply_tenant_rls` |
| `security_login_attempt` | `id` | `tenant_id` (nullable), `user_id` (nullable) | — | tenant, `(identifier, created_at)`, `(ip_address, created_at)` | `apply_tenant_rls_nullable` |
| `security_event` | `id` | `tenant_id` (nullable), `actor_user_id` (nullable) | — | tenant, actor, `(event_type, created_at)` | `apply_tenant_rls_nullable` |

No `membership` table existed. No `Membership` Prisma model existed.

## The load-bearing fact this phase changes

`security_user.tenant_id` was **required** and part of the row's own uniqueness (`(tenant_id, email)`). This is what made "one user, one tenant" true by construction rather than by convention — there was no schema shape in which a `security_user` row could exist independent of exactly one `tenant_id`. Every other table's tenant/organization scoping (role grants, sessions, tokens) was layered on top of that one fact.

## Tenant-scoped vs. organization-scoped vs. global, before Phase 2A

- **Tenant-scoped, required**: `security_user` (via `tenant_id`), `organization`, `organization_unit`, `organization_unit_hierarchy`, `security_user_role`, `security_session`, `security_refresh_token`, `security_password_reset_token`, `security_user_invitation_token`.
- **Tenant-scoped, nullable (system-wide when null)**: `security_role`.
- **Organization-scoped, nullable (tenant-wide when null)**: `security_user_role.organization_id`, `security_session.organization_id` (present, but nothing ever wrote a non-null value — organization-context switching was out of Phase 1 scope).
- **Global, no `tenant_id` column at all**: `tenant` itself, `organization_type`, `organization_unit_type`, `security_permission`, `security_role_permission` (scoped transitively through `role_id`).

## RLS policies present

Exactly two policy-generating procedures, both already documented in `database/shared/002_functions.sql`: `apply_tenant_rls(table)` (required `tenant_id`, strict equality) and `apply_tenant_rls_nullable(table)` (nullable `tenant_id`, read includes NULL rows, write requires a real match). Every RLS-bearing table above used one of these two, unmodified, verbatim.

## Triggers/functions present

`generate_uuid()`, `current_tenant_id()`, `current_user_id()`, `fn_set_audit_fields()` (bumps `updated_at`/`version` on UPDATE), `fn_enforce_soft_delete()` (rewrites DELETE into an UPDATE setting `deleted_at`/`deleted_by`), and the `apply_standard_triggers(table)` procedure that wires the latter two onto any table carrying the standard audit column set. Applied to: `tenant`, `organization_type`, `organization`, `organization_unit_type`, `organization_unit`, `security_user`, `security_role`, `security_permission`. Not applied (by design, no soft-delete semantics) to `security_user_role`, `security_session`, the token tables, or the append-only audit tables.

## What Phase 2A actually changes here

Exactly: `security_user` loses `tenant_id` (and its RLS policy, and its old unique constraint) and gains a global `email` unique constraint; a new `membership` table is added; `security_user_invitation_token` gains a required `organization_id`. Every other row in the tables above is unchanged in shape. See `docs/PHASE_2A.md` for the full after-state and rationale.
