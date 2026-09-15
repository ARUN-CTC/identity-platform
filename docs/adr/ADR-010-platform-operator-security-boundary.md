# ADR-010: Platform Operator Security Boundary

## Context

Phase 2B built Product/Application registration and needed *some* answer to "who may call these platform-level admin endpoints." Lacking a real platform-operator principal (a gap `docs/IDENTITY_DOMAIN_MODEL.md` §6 had already flagged), it reused the existing tenant-scoped `SUPER_ADMIN` system role as a stand-in — documented at the time as deliberate but temporary. Phase 2B.1's job is to replace that stand-in with a genuine, structurally separate platform-authority boundary.

## Problem

`SUPER_ADMIN`'s authority was only ever reachable through a `security_user_role` row, which requires a `tenant_id`. That makes platform-level authority a tenant-scoped grant by construction — the opposite of what "platform-level" is supposed to mean. It also conflates two independent questions this phase must keep separable: *is this person a platform administrator* and *is this person a member of some organization* — Phase 1/2A's tenant-scoped RBAC mechanism cannot express "yes to the first, no requirement on the second" without a new, dedicated mechanism.

## Options

1. **`role = PLATFORM_OPERATOR`**, granted the same way any other tenant-scoped role is (a `security_user_role` row). Rejected outright — this is exactly the `SUPER_ADMIN` problem restated with a new name; platform authority would still be reachable only via a tenant-scoped grant row, and a `tenant_id` would still have to be picked for something that isn't tenant data.
2. **A first-class `platform_operator` entity**, structurally separate from `Membership`/`security_user_role`, referencing the global Identity (`security_user`) directly, with its own permission-grant table, its own session/token pair, and its own guards. **Chosen.**

## Decision

Option 2. `platform_operator` (1:1 with a `security_user`, no `tenant_id`, no RLS) is the authority boundary; `platform_operator_permission` grants specific platform-only permission codes directly to it (no intermediate "platform role" — see `docs/PLATFORM_OPERATOR_AUTHORIZATION.md` for why); `platform_operator_session`/`platform_operator_refresh_token` are a dedicated session/token pair, never `security_session`/`security_refresh_token`; `PlatformJwtAuthGuard`/`PlatformPermissionsGuard` are dedicated guards, never the tenant-scoped `JwtAuthGuard`/`PermissionsGuard`. Every existing tenant-scoped table, guard, and token shape is untouched.

## Rationale

Structural separation is what makes the required invariants actually true rather than merely policy: a Platform Operator has zero Memberships because nothing in this design ever creates one; a Tenant Admin has no platform authority because `platform_operator` is looked up by `user_id`, never derived from any role or permission a tenant grant happens to include. A shared-table design (Option 1, or a design that let `security_user_role` carry platform-only permissions) would require an ongoing application-level promise to keep the two separate — this design makes it a schema fact, additionally enforced at the database level: `security_permission.platform_only` plus a trigger that rejects attaching such a permission to any tenant-scoped role (`security_role_permission`), so the boundary survives even a bug or a future engineer's mistake, not just correct application code.

## Consequences

- **SUPER_ADMIN migration**: `SUPER_ADMIN` is kept as a legitimate, broad *tenant-scoped* role (every non-platform-only permission) rather than deleted or renamed — existing tenant-level access is preserved. Every existing holder of `SUPER_ADMIN` is migrated into a real `platform_operator` row, granted every platform-only permission that existed at migration time, so no administrator loses access. Going forward, `SUPER_ADMIN` alone no longer suffices for any platform-level action — Product/Application administration (Phase 2B) now requires Platform Operator authentication, a deliberate, tested, documented breaking change to those two controllers (`docs/PHASE_2B1.md`).
- **A parallel, minimal auth/session stack was required**, not merely a new permission check — because a Platform Operator may hold zero Memberships, the existing tenant login flow (which always resolves a Tenant and checks Membership) cannot authenticate one. `docs/PLATFORM_OPERATOR_ARCHITECTURE.md` §"Authentication" has the full reasoning for why this is additive (a new claims shape, a new pair of tables) rather than a redesign of the existing tenant token/session model.
- **Platform-scoped audit events** needed a real schema fix (`security_event.scope`), not another workaround — Phase 2B's own "borrow the acting admin's ambient tenant_id" pattern breaks the moment the acting admin has no tenant context at all, which a Platform Operator, by design, may not.

## Risks

Two authentication stacks (tenant, platform) now exist side by side, which is real ongoing surface to maintain — accepted, because the alternative (one stack, with platform authority routed through it) is exactly the design that produced the problem this ADR fixes. Mitigated by maximal code reuse where reuse doesn't compromise the boundary: the same `security_user`/Argon2id/brute-force-lockout machinery, the same refresh-rotation-with-reuse-detection pattern, the same grant-ceiling rule, applied twice rather than invented twice.
