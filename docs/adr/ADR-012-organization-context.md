# ADR-012: Organization Context & Cross-Tenant Discovery

## Context

`docs/ORGANIZATION_CONTEXT.md` (written during Phase 2 architecture) already decided the high-level shape of organization-context switching — Option D, a hybrid of session-level state and short-lived token reflection — but left it entirely undesigned at the mechanism level, and explicitly deferred one open question (§4a): the global-Identity change (ADR-002) means a Membership-holding switch target can now be in a **different Tenant** than the caller's current session, which the original Option D write-up did not account for. Phase 2C's job is to actually build it.

## Problem

Resolving a client-supplied `organizationId` into "which Tenant is this, and does the caller actually belong to it" requires reading the `membership` table — but `membership` carries ordinary tenant RLS (`tenant_id = current_tenant_id()`), and there is, by definition, no `current_tenant_id()` GUC to set yet: that is exactly the value this lookup exists to produce. A same-tenant-only design could sidestep this by trusting the session's already-established tenant context — but that would silently exclude the exact cross-tenant case the global-Identity model exists to support, and would re-introduce a "one identity, one tenant" assumption Phase 2A spent an entire phase removing.

## Options

1. **Restrict organization-context switching to the caller's current Tenant only**, and treat cross-tenant switching as "log out, log back in with a different tenantCode." Rejected — this is a regression against Phase 2A's own stated purpose (a single global Identity legitimately spanning multiple Tenants) and pushes exactly the UX cost Option D was chosen to avoid (`docs/ORGANIZATION_CONTEXT.md` §2, Option A's rejected drawback) back onto the multi-tenant case.
2. **A dedicated cross-tenant lookup table or materialized view** (e.g., a denormalized `user_id -> [organization_id, tenant_id]` index maintained outside RLS entirely, readable without any tenant context). Rejected — a second source of truth that must be kept in sync with `membership` on every membership create/status-change is exactly the kind of consistency risk this platform's design otherwise avoids (compare: Phase 2B.2 chose to recompute entitlement live rather than cache it, for the same reason).
3. **A narrow, read-only RLS relaxation on `membership` itself**, permitting a row to be read when it matches the connection's own authenticated `current_user_id()` GUC, in addition to the existing tenant match — write access (`WITH CHECK`) entirely unchanged. **Chosen.**

## Decision

Option 3. `database/ddl/008_organization_context.sql` replaces `membership`'s `USING` clause with `(tenant_id = current_tenant_id() OR user_id = current_user_id())`, leaving `WITH CHECK (tenant_id = current_tenant_id())` untouched. `current_user_id()` is populated exclusively by `PrismaContextService` from the server's own `RequestContextService.userId` (itself populated exclusively by `JwtAuthGuard` from a verified JWT's `sub` claim) — never from any client-supplied value. `MembershipsRepository.findByUserAndOrgAnyTenant(userId, organizationId)` and `.listActiveForUser(userId)` are the only two call sites that rely on this relaxation; every other read of `membership` continues to run with an explicit tenant GUC exactly as before.

## Rationale

This is the smallest change that makes the required property true: "a caller can always discover their own cross-tenant memberships, and never anyone else's," expressed as a single, auditable RLS predicate rather than an application-level promise repeated at every call site. It reuses the existing RLS/GUC mechanism (no new authorization primitive, no bypass, no `BYPASSRLS` grant to any role) and keeps the blast radius to exactly one table's read policy — every other table (`organization`, `tenant`, `security_user_role`, etc.) is untouched, and each of those is still fetched with an explicit `actingAsTenantId` once the target Tenant is known, the same cross-tenant pattern Platform Operator administration already established (Phase 2B.1/2B.2). A materialized index (Option 2) was rejected for the same reason Phase 2B.2 rejected caching entitlement decisions: an out-of-band structure that can drift from the row it summarizes is a correctness risk this platform has consistently avoided taking on without a demonstrated need.

## Consequences

- **Every future table that needs the same "read my own cross-tenant rows before a tenant context exists" property has a precedent to follow** — the same `OR <owner-column> = current_user_id()` shape, narrowly scoped, `WITH CHECK` left untouched. This is not a general-purpose escape hatch; it must be justified per-table, the same way this ADR justifies it for `membership`.
- **`security_user.current_organization_id` was not created.** Organization context lives on `SecuritySession` (already present since Phase 1), not on the global Identity — this is what makes independent, concurrent contexts per device/browser/client correct by construction rather than by convention, and directly resolves `docs/ORGANIZATION_CONTEXT.md` §4a's account-suspension-scope question by not conflating account-level state with session-level state in the first place: a Membership/Organization/Tenant status change is what actually gates access, always re-checked live: the session-level `organizationId` is inert without one.
- **A cross-tenant switch always mints a new session**, never mutates `tenant_id` on an existing row — `tenant_id` is the RLS partition key and must stay immutable per-row. This is a small extra code path (`switchOrganizationContext()`'s `isCrossTenant` branch) but avoids ever needing a table-level exception to that invariant.

## Risks

The relaxed `membership` policy is the one place in this schema where a read can succeed with **no** tenant GUC set at all — a reviewer auditing RLS policies must know this is deliberate and narrowly self-scoped, not an oversight. Mitigated by: the extensive doc comment directly on the policy in `database/ddl/008_organization_context.sql`, this ADR, and `docs/ORGANIZATION_CONTEXT_SECURITY.md` §1, plus the fact that `WITH CHECK` (every write) was left completely unchanged — even in the relaxed-read window, a Membership row can never be *created or modified* outside its own tenant's context.
