# Platform Operator Authorization

## 1. Why direct grants, not roles

`platform_operator_permission` grants specific permission codes directly to an operator — there is no `platform_role`/`platform_operator_role` intermediary. This was a deliberate rejection of the tenant-scoped RBAC pattern (`Role` → `RolePermission` → `UserRole`) for platform scope, evaluated and declined:

- **Least privilege is the point.** The brief's own guidance (Step 8) is explicit: "a Platform Operator should not automatically mean unrestricted... access." Different operators legitimately need different, non-overlapping subsets (an operator who only manages Products should not also be able to create other operators). A role layer would need either a proliferation of narrow roles (one per meaningful permission combination — no real savings over direct grants) or a small number of broad roles (reintroducing the "too much at once" problem this document exists to avoid).
- **No redundant entity.** At Phase 2B.1's scale there is exactly one meaningful "everything" bundle (what the seeded dev operator and the bootstrap script both grant) — introducing a `Role` abstraction to name that one bundle is exactly the kind of speculative complexity `docs/PRODUCT_REGISTRATION.md` and `docs/adr/ADR-009-application-client-model.md` already argued against elsewhere in this codebase for the same reason.
- If a real future need for reusable named bundles appears (e.g., onboarding many operators with the same standard permission set), a `PlatformRole` can be added later as a strictly additive convenience layered on top of the existing direct-grant table — not a redesign.

## 2. Platform permission catalog

| Code | Meaning | Notes |
|---|---|---|
| `PRODUCT_VIEW` / `PRODUCT_MANAGE` | View / register & update Products | Existing since Phase 2B, now `platform_only = TRUE` |
| `APPLICATION_VIEW` / `APPLICATION_MANAGE` | View / register & update Applications and issue credentials | Existing since Phase 2B, now `platform_only = TRUE` |
| `PLATFORM_OPERATOR_VIEW` / `PLATFORM_OPERATOR_MANAGE` | View / create, disable, reactivate Platform Operators and grant/revoke their permissions | New in Phase 2B.1 |
| `PLATFORM_SECURITY_VIEW` | View platform-scoped (`scope='PLATFORM'`) security events | New in Phase 2B.1 |

**Deliberately not created** (Step 8's own instruction: "do not create permissions unnecessarily"):

- `PLATFORM_VIEW`/`PLATFORM_MANAGE` — no concrete capability exists yet that isn't already covered by a more specific code (Product, Application, Operator, Security). A generic catch-all with nothing specific to gate would be a permission nobody can reason about the scope of.
- `PLATFORM_SECURITY_MANAGE` — `security_event` is append-only everywhere else in this codebase (no update/delete methods exist on `SecurityEventsService` on purpose); there is no "manage" operation on an audit log to gate.

Every code above lives in the same `security_permission` table as tenant-scoped codes (`USER_MANAGE`, etc.) — see `docs/adr/ADR-010-platform-operator-security-boundary.md` for why one physical catalog with a `platform_only` flag was chosen over a separate platform-permission table.

## 3. Enforcement: `PlatformPermissionsGuard`

Resolves `@RequirePlatformPermissions(...)` (AND semantics, same as the tenant-scoped `@RequirePermissions`) against `platform_operator_permission` for `RequestContextService.operatorId` — populated exclusively by `PlatformJwtAuthGuard`, which runs first in every platform controller's guard chain. A route with no `@RequirePlatformPermissions` decorator is reachable by any authenticated (non-disabled) Platform Operator — deny-by-default still applies in the sense that every *write* endpoint in this phase carries an explicit permission requirement; none rely on "authenticated is enough."

## 4. Grant-ceiling rule

Identical in spirit to the tenant-scoped rule already proven in Phase 1/2A (`UserRolesService.assertCallerCanGrant`), reimplemented for platform scope (`PlatformOperatorsService.assertCallerCanGrant`): an operator may grant another operator (at creation, via `POST /v1/platform/operators`, or afterward, via `POST /v1/platform/operators/:id/permissions`) only permission codes the **granting** operator already holds themselves. Attempting to grant a code the caller lacks is rejected with 403, checked server-side against the database on every call — never inferred from a client-supplied list. Tested directly (`tests/phase2b1-platform-operator.e2e-spec.ts`, "Grant-ceiling — cannot escalate privilege").

## 5. What Platform Operator permissions do *not* grant

Nothing here confers tenant-scoped authority (`USER_MANAGE`, `ORGANIZATION_MANAGE`, etc.) or Organization Membership of any kind — see `docs/PLATFORM_OPERATOR_ARCHITECTURE.md` §10. A Platform Operator wanting to also act within a specific tenant needs an ordinary Membership and an ordinary tenant login, exactly like anyone else; platform authority is never a backdoor into tenant data.
