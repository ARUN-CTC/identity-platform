# Platform Operator Lifecycle

## 1. States

```text
                 grant authority
                (POST /v1/platform/operators)
                        │
                        ▼
                     ACTIVE ───────────────┐
                        │  disable          │  reactivate
                        │  (PATCH status)   │  (PATCH status)
                        ▼                   │
                    DISABLED ───────────────┘
```

No `DELETED` state, no delete endpoint. Consistent with `Product`/`Application` (`docs/PHASE_2B.md`) and for the same reason, doubly so here: audit history for a security principal (who had platform authority, when, and what they did with it) must remain meaningful and queryable indefinitely — hard-deleting the row would sever `security_event.actor_user_id`'s ability to attribute past actions to a name a reader could still look up.

## 2. Endpoints

| | |
|---|---|
| **POST /v1/platform/operators** | Auth: Platform Operator, `PLATFORM_OPERATOR_MANAGE`. Request: `{email, permissionCodes: string[]}`. Requires `email` to already resolve to an existing, already-activated global Identity (400 otherwise); 409 if that Identity already has a `platform_operator` row (any status); every `permissionCode` is grant-ceiling-checked against the caller's own grants (403 if any exceed it). Audit: `PLATFORM_OPERATOR_CREATED`. |
| **GET /v1/platform/operators** | Auth: `PLATFORM_OPERATOR_VIEW`. Paginated. |
| **GET /v1/platform/operators/:id** | Auth: `PLATFORM_OPERATOR_VIEW`. Includes the operator's current `permissionCodes`. |
| **PATCH /v1/platform/operators/:id** | Auth: `PLATFORM_OPERATOR_MANAGE`. Request: `{status: 'ACTIVE' | 'DISABLED'}`. Disabling revokes every session/refresh-token this operator holds. 409 if this would leave zero `ACTIVE` operators (`LAST_ACTIVE_PLATFORM_OPERATOR`) — enforced at the database level (see §4). Audit: `PLATFORM_OPERATOR_DISABLED` / `PLATFORM_OPERATOR_REACTIVATED`. |
| **POST /v1/platform/operators/:id/permissions** | Auth: `PLATFORM_OPERATOR_MANAGE`, grant-ceiling-checked. Request: `{permissionCode}`. 409 if already granted; 400 if the code isn't a real `platform_only` permission. Audit: `PLATFORM_OPERATOR_PERMISSION_GRANTED`. |
| **DELETE /v1/platform/operators/:id/permissions/:code** | Auth: `PLATFORM_OPERATOR_MANAGE`. Audit: `PLATFORM_OPERATOR_PERMISSION_REVOKED`. |
| **POST /v1/platform/auth/login** | Public. Request: `{email, password, deviceInfo?}` — no `tenantCode`. Same generic `PLATFORM_INVALID_CREDENTIALS` failure whether the email doesn't exist, the password is wrong, or the account exists but has no active Platform Operator grant (no enumeration signal — `docs/PLATFORM_OPERATOR_ARCHITECTURE.md` §3). Audit: `PLATFORM_LOGIN_SUCCESS` / `PLATFORM_LOGIN_FAILURE`. |
| **POST /v1/platform/auth/refresh** | Public (token-authenticated). Same rotation-with-reuse-detection semantics as tenant refresh (`docs/TOKEN_ARCHITECTURE.md`), plus a live operator-status re-check on every call. |
| **GET /v1/platform/auth/me** | Auth: Platform Operator (any). Returns the caller's own id/email/`permissionCodes`. |
| **POST /v1/platform/auth/logout** | Auth: Platform Operator (any). Revokes the current session + its refresh tokens. |
| **GET /v1/platform/audit-events** | Auth: `PLATFORM_SECURITY_VIEW`. Paginated, filterable by `eventType`. Only `scope='PLATFORM'` rows. |

Every one of these is a DTO-validated, explicitly-authorized, explicitly-audited endpoint (Step 18's cross-cutting requirement) — no internal database row is ever returned directly (`clientSecretHash`-style stripping applies here too: `platform_operator_session`/`refresh_token` internals are never serialized into any response).

## 3. Self-management

An operator may disable **another** operator or **themselves** through the same endpoint — no special-cased "cannot touch your own record" rule exists, because the one scenario that rule would exist to prevent (accidentally leaving the platform with zero operators) is already prevented more generally, and more robustly, by the last-active-operator invariant below, which applies identically whether the disabling operator is disabling themselves or someone else. A narrower "cannot self-disable" rule was considered and rejected: it would not actually be sufficient on its own (two operators could still disable *each other* down to zero without ever "self"-disabling), so the real invariant has to exist regardless — adding a redundant, narrower rule on top would only add a special case without adding safety.

## 4. Last-active-operator protection

Enforced in the database (`trg_platform_operator_protect_last_active`, `database/ddl/006_platform_operator.sql`), not solely in application code:

```sql
PERFORM pg_advisory_xact_lock(hashtext('platform_operator_active_count'));
-- (recompute the active count only after acquiring the lock, so a
--  concurrent transaction's already-committed change is always visible)
```

This is what makes the invariant hold under concurrency, not just in the common case: two simultaneous requests attempting to disable the last two active operators are serialized by the advisory lock — whichever commits first is counted by the second, so the second's own recount correctly sees "1 remaining, and I'd be the last" and is rejected, deterministically, never based on a stale read. Verified directly (`tests/phase2b1-platform-operator.e2e-spec.ts`, "is enforced at the database level, concurrency-safely") by firing two concurrent Prisma updates directly at the trigger and asserting the active count never reaches zero, regardless of which (if either, if both) succeeds.

The same trigger also fires on `DELETE` (defense-in-depth — Phase 2B.1 has no delete endpoint, but a direct database delete is guarded the same way a status-flip is).

## 5. Token security detail

See `docs/PLATFORM_OPERATOR_ARCHITECTURE.md` §14 for the full reasoning; restated here as the lifecycle-relevant fact: disabling an operator has two independent, immediate effects — (a) every existing session/refresh-token is explicitly revoked in the same call, and (b) `PlatformJwtAuthGuard` re-checks the operator's live status on every subsequent request regardless. Either alone would leave a gap; both together close it completely, with no reliance on token expiry.

## 6. What is deliberately not built

A "resend invitation"-style flow for onboarding a brand-new Identity directly into Platform Operator status (`docs/PLATFORM_OPERATOR_ARCHITECTURE.md` §5); a `PlatformRole` convenience layer (§1 of `docs/PLATFORM_OPERATOR_AUTHORIZATION.md`); a rotation *workflow* for anything (no credential rotation endpoints exist in this phase either, consistent with `docs/PHASE_2B.md`).
