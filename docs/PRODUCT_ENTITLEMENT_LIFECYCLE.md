# Product Entitlement Lifecycle

## 1. States and transitions

```text
              create (always ACTIVE)
                      │
                      ▼
     ┌──────────── ACTIVE ◄───────────┐
     │                │               │
  suspend           revoke        activate
     │                │               │
     ▼                ▼               │
 SUSPENDED ──revoke──► REVOKED         │
     │                  │             │
     └──── activate ─────┘            │
             (BLOCKED — see below)    │
                        reactivate ───┘
                    (explicit, separate action)
```

| Transition | Reachable via | Notes |
|---|---|---|
| (none) → ACTIVE | `POST .../product-entitlements` | Creation always starts ACTIVE — no `PENDING` (see §2). |
| ACTIVE → SUSPENDED | `PATCH .../product-entitlements/:productId` | Reversible. |
| SUSPENDED → ACTIVE | `PATCH .../product-entitlements/:productId` | Reversible. |
| ACTIVE → REVOKED | `PATCH .../product-entitlements/:productId` | Does not require suspending first. |
| SUSPENDED → REVOKED | `PATCH .../product-entitlements/:productId` | Does not require returning to ACTIVE first. |
| REVOKED → ACTIVE | `POST .../product-entitlements/:productId/reactivate` **only** | **Never** reachable via the generic PATCH — see §3. |
| REVOKED → SUSPENDED | Not reachable, any path | REVOKED is more terminal than SUSPENDED; there is no reason to "un-revoke into suspended." |

## 2. Why no `PENDING`

Nothing in this phase produces or consumes a pending-approval workflow — there is no request-access flow, no approval queue, no external trigger that would ever move a row *into* `PENDING` or *out of* it. Adding the state without a real transition trigger would be dead weight: a status value that could never correctly be observed changing. `ACTIVE`-on-creation matches the same convention `Product`/`Application` already use (Phase 2B). If a future approval workflow is ever built, `PENDING` can be added additively (a new state, a new transition into `ACTIVE`) without touching this phase's existing transitions.

## 3. Why reactivation is a distinct transition/endpoint

`REVOKED` is meant to communicate "administratively, deliberately removed" — treating it as just another value the generic status-PATCH can freely move into and out of would make an accidental `PATCH {status: 'ACTIVE'}` indistinguishable from a considered reactivation decision. `POST .../reactivate` is the **only** path back, audited as its own event type (`PRODUCT_ENTITLEMENT_REACTIVATED`, not a generic "activated"), so the audit trail itself preserves the distinction between "was suspended, now un-suspended" and "was revoked, and someone made the deliberate call to restore it." Enforced at three layers: the generic PATCH endpoint's own transition table excludes `REVOKED → ACTIVE`; the repository's guarded UPDATE (`WHERE status IN (fromStatuses)`) would refuse it even if the service layer had a bug; and the two are tested independently (`tests/phase2b2-product-entitlement.e2e-spec.ts`).

## 4. Concurrency

State transitions are implemented as guarded, conditional UPDATEs — `UPDATE ... SET status = $to WHERE tenant_id = $t AND product_id = $p AND status IN ($fromStatuses)` — evaluated atomically under Postgres's own row lock, not a read-then-write pattern an application-level race could slip between. This is what makes the following properties hold without any additional locking/version-field machinery:

- **Duplicate creation** (`UNIQUE(tenant_id, product_id)`): a race between two concurrent creates for the same pair always resolves to exactly one `201` and one `409` — the losing INSERT hits the constraint and is translated to the same conflict response, never an unhandled error. Tested directly, including a genuine concurrent-request race (`tests/phase2b2-product-entitlement.e2e-spec.ts`, "a concurrent duplicate-create race resolves to exactly one record").
- **REVOKE racing SUSPEND** (brief's own required scenario — "the stronger terminal state wins"): achieved *for free* by the transition table's own shape, not a special case. REVOKE's guard accepts `fromStatuses = ['ACTIVE', 'SUSPENDED']` (reachable from either); SUSPEND's guard accepts only `['ACTIVE']`. Whichever commits first, the *other* re-evaluates its own guard against the now-current row: if SUSPEND lands first (ACTIVE→SUSPENDED), REVOKE's guard still matches (SUSPENDED is in its fromStatuses) and applies, ending in REVOKED; if REVOKE lands first (ACTIVE→REVOKED), SUSPEND's guard (`status = 'ACTIVE'`) no longer matches and it correctly no-ops. Both commit orders converge to `REVOKED`. Verified directly by firing both concurrently and inspecting the final row state (`tests/phase2b2-product-entitlement.e2e-spec.ts`, "concurrent SUSPEND and REVOKE converge to REVOKED").
- **ACTIVE/SUSPENDED racing itself**: ordinary Postgres row-locking serializes the two writers; the row ends in exactly one, valid, non-corrupted state (never a hybrid) — which of the two "wins" depends on commit order, which is an accepted, standard last-write-wins outcome for a single-row status field, the same guarantee every other status field in this codebase already relies on (no optimistic-locking/version-check exists for `Product.status`/`Application.status` either).

No `pg_advisory_xact_lock`-style cross-row coordination (unlike Phase 2B.1's last-active-operator invariant) was needed here — every invariant in this phase is expressible as a single-row guarded UPDATE or a plain UNIQUE constraint, both already atomic under Postgres's standard MVCC/row-locking model.

## 5. Effect on access, and staleness

Entitlement status is read live by `ProductAccessService.canAccess()` on every call — there is no caching layer in this phase (`docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md` §10), so a status transition takes effect on the very next evaluation, with no propagation delay to reason about. This is a deliberate simplicity choice for a phase with no wired-in per-request product-boundary check yet; a future phase adding one should re-read §10 of the architecture doc before introducing any caching.

## 6. Security invariants (restated, all enforced, all tested)

1. Entitlement is not membership — no code path derives one from the other.
2. Entitlement is not authorization — `ProductAccessService` knows nothing about roles/permissions.
3. Entitlement is not billing — no billing concept exists anywhere in this model.
4. Product registration does not automatically grant access — verified directly.
5. Application registration does not automatically grant access — Applications and Entitlements share no table, no code path.
6. No entitlement means deny — the default branch of `ProductAccessService`.
7. Suspended entitlement means deny — explicit branch.
8. Revoked entitlement means deny — explicit branch.
9. Disabled product means deny — checked first, takes precedence over entitlement status.
10. Tenant A entitlement cannot affect Tenant B — RLS + explicit tenantId scoping, tested directly.
11. Organization membership cannot bypass entitlement — Membership and Entitlement are checked independently; neither substitutes for the other.
12. Entitlement cannot bypass organization authorization — same independence, the other direction.
13. Tenant Admin cannot self-grant product entitlement — tested directly, including the "owns every organization" variant.
14. JWT claims cannot self-grant entitlement — every check re-derives state from the database on every request; nothing in a token is treated as an entitlement claim.
15. Platform Operator does not automatically become tenant member — unchanged from Phase 2B.1; entitlement management never creates a Membership.
16. Platform Operator does not bypass RLS — the `actingAsTenantId` mechanism (§7 of the architecture doc) keeps RLS fully enforced, scoped to the named tenant only.
17. Every entitlement mutation is auditable — `PRODUCT_ENTITLEMENT_CREATED`/`_ACTIVATED`/`_SUSPENDED`/`_REVOKED`/`_REACTIVATED`, all `scope='PLATFORM'`, all attributing the acting Platform Operator's own Identity — never a fake tenant attribution.
18. Duplicate tenant/product entitlement is impossible — `UNIQUE(tenant_id, product_id)`, race-tested.
19. Concurrent mutations cannot corrupt state — guarded UPDATEs, race-tested (both the "stronger state wins" case and the plain toggle case).
20. TravelOS remains untouched — verified (`docs/PHASE_2B2.md`).
