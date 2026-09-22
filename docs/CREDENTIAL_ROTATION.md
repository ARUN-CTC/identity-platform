# Credential Rotation — Applications & Service Accounts

Phase 2UI.2 — the two remaining P0 gaps Phase 2UI.1 found: an Application's `client_secret` and a ServiceAccount's `credential` could each be *created* (once, plaintext, shown exactly once) but never *rotated*. A leaked production credential's only remedy was recreating the entire Application/ServiceAccount from scratch — losing its `client_id`/id and forcing every dependent config to be updated, not just the secret. Both gaps are fixed the same way, mirrored exactly across the two resource types.

## 1. The API

```text
POST /applications/:id/credentials/rotate       — APPLICATION_MANAGE
POST /service-accounts/:id/credentials/rotate   — SERVICE_ACCOUNT_MANAGE
```

No `/platform/` prefix — matching the *existing* routes for these two resources (`GET/PATCH /applications/:id`, `GET/PATCH /service-accounts/:id`), which never carried one either; "platform-ness" is expressed by the guards (`PlatformJwtAuthGuard` + the relevant `RequirePlatformPermissions`), not the URL path, for these specific resources. No request body — rotation takes no input, matching the existing no-body convention for action endpoints elsewhere in this codebase (`POST .../reactivate`). Response mirrors the creation response shape exactly (`CreatedApplication`/`CreatedServiceAccount`) — the new plaintext secret, shown exactly once, everything else identical to a `GET`.

Reuses the *existing* `APPLICATION_MANAGE`/`SERVICE_ACCOUNT_MANAGE` permission codes — the same ones `update()` already requires. No new permission was created.

## 2. Rotation semantics: ATOMIC REPLACEMENT, not overlapping/graceful rotation

**Decision**: rotating a secret immediately and irreversibly replaces it. There is no grace period during which both the old and new secret verify.

**Why**, precisely: `Application.clientSecretHash` (and `ServiceAccount.credentialHash`) is a single nullable column, not a one-to-many credential table. The schema already carries `secretCreatedAt`/`secretRevokedAt` (Application) and `credentialCreatedAt`/`credentialRevokedAt` (ServiceAccount) — timestamps that anticipate *some* notion of credential lifecycle — but neither schema was ever built to hold two simultaneously-valid secrets for one Application/ServiceAccount. Building genuine overlapping-grace-period rotation would require a new, separate one-to-many Credential entity (its own table, its own RLS/relations, its own repository/service layer, a real migration) — judged disproportionate to add "merely for convenience" (this phase's own governing instruction) when atomic replacement is both fully sufficient for the stated goal (give a leaked credential a real remedy that doesn't require recreating the whole resource) and consistent with a security posture this platform already firmly commits to elsewhere: `OneTimeSecretDialog`'s own one-time-reveal, no-second-chances philosophy. Rotation is, conceptually, "create a new one, same mechanism, immediately supersedes the old" — not a new idea, the same idea applied a second time to an existing resource instead of a brand-new one.

**The documented operational consequence** (as this phase's own governing instruction requires when choosing atomic replacement over overlap): a product mid-deployment still using the *old* secret will start failing `client_secret_basic`/`client_secret_post` authentication at `POST /oauth/token` (Applications) or `client_credentials` grant requests (ServiceAccounts) **the instant rotation commits**, until the new secret is deployed to that product's own runtime. There is no built-in overlap window to absorb a slow rollout. Operational recommendation: rotate during a maintenance window, or coordinate the swap directly with the product team before triggering it — this is a real, load-bearing operational step, not a formality.

## 3. `secretRevokedAt` / `credentialRevokedAt` — semantics defined by this phase

Both columns existed in the schema already but had **zero write call sites anywhere in the codebase** before this phase (confirmed by search) — scaffolded, never wired, semantics never finalized by whichever earlier phase added them. This phase defines them precisely: **non-null means "this resource currently has no valid credential"** (a state only a future, still-unbuilt standalone "revoke without reissue" action would produce — explicitly out of this phase's four P0 gaps). Rotation's own write always leaves this column `null` on the row it just updated — the *new* secret, freshly created, is by definition not itself revoked. `secretCreatedAt`/`credentialCreatedAt` update to the rotation's own timestamp, exactly mirroring what creation itself already sets.

## 4. Concurrency safety

Both `Application` and `ServiceAccount` already carry a trigger-maintained `version` column (`fn_set_audit_fields`, increments on every `UPDATE`). Rotation reads the row's current `version`, then issues a conditional `updateMany({ where: { id, version: expectedVersion }, data: {...} })` — exactly the same optimistic-lock pattern `TenantProductEntitlementsRepository.transition()` already established for entitlement state transitions. Two simultaneous rotation requests both read the same starting `version`; only the first `UPDATE` to commit actually matches the `WHERE` clause (the trigger has already advanced `version` by the time the second one runs), so the second affects zero rows and the caller receives a clean `409 CONCURRENT_MODIFICATION` — never a silently-overwritten secret, and never two callers each shown a plaintext value where only one is actually still valid.

## 5. Eligibility (checked before generating anything)

| Check | Application | ServiceAccount |
|---|---|---|
| Must exist | 404 otherwise | 404 otherwise |
| Must be the right client type | `clientType === 'CONFIDENTIAL'` — a `PUBLIC` application has no secret at all (PKCE is its only proof of possession); rotating one is a `400`, not a no-op | N/A — every ServiceAccount always has a credential |
| Must be in an eligible status | `status === 'ACTIVE'` — `SUSPENDED`/`DISABLED` rejected with `409` | `status === 'ACTIVE'` — `SUSPENDED`/`DISABLED` rejected with `409` |

The status gate is a deliberate, conservative default: there is no legitimate reason to hand a fresh, live secret to a resource an operator has specifically taken out of service. Reactivate first (existing `PATCH .../status`), then rotate.

## 6. Security discipline (reused, not reinvented)

Both rotation methods reuse the *exact same* utilities `create()` already uses — `generateClientSecret()` (256-bit random, base64url), `hashClientSecret()` (SHA-256, deliberately not a memory-hard KDF — a client_secret/service-account-credential is never attacker-guessable low-entropy input, the same reasoning this codebase already documents for every other non-human-facing credential). No new cryptographic code was written for this phase.

- Never persisted or logged in plaintext — the hash is the only thing written to the database.
- Never included in an audit event — `CLIENT_CREDENTIAL_ROTATED`/`SERVICE_ACCOUNT_CREDENTIAL_ROTATED` metadata carries only the (non-secret, safe-to-log) `clientId`, nothing else.
- Never returned by any `GET` — the response's own `clientSecret`/`credential` field only ever appears on the `create()`/`rotate()` response itself, stripped everywhere else exactly like today.
- Never appears in a thrown exception message.

## 7. Audit events (new)

```text
CLIENT_CREDENTIAL_ROTATED              (Application)  — mirrors the existing CLIENT_CREDENTIAL_CREATED naming
SERVICE_ACCOUNT_CREDENTIAL_ROTATED     (ServiceAccount) — mirrors the existing SERVICE_ACCOUNT_CREDENTIAL_CREATED naming
```

## 8. Frontend contract

The future Admin Console reuses `OneTimeSecretDialog` **unmodified** for the rotation response — the component's own props already accept an arbitrary label/value pair; a "Rotate secret" button simply calls this new endpoint and opens the same dialog with the response's plaintext, exactly as `ApplicationFormDrawer`'s creation flow already does. No new secret-display component is needed. Recommended UX addition (not built this phase — UI implementation is out of scope): a short warning before confirming rotation, stating plainly that the old secret stops working immediately (§2).

## 9. Deferred, explicitly

Overlapping/graceful rotation (a real Credential entity, multiple simultaneously-valid secrets) — tracked as a documented future enhancement if a product's own deployment cadence genuinely needs a zero-downtime rotation window; not built here per §2's reasoning. A standalone "revoke without reissue" action (kill a credential with no replacement) — the `secretRevokedAt`/`credentialRevokedAt` columns are ready for it (§3), but it wasn't one of this phase's four listed P0 gaps.
