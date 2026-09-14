# TravelOS Identity Migration Plan

Phase 2E.1. The phased data/identity migration plan — planning only; no phase below is executed in 2E.1.

## 1. Migration phases

| # | Phase | Input | Output | Owner | Validation | Rollback |
|---|---|---|---|---|---|---|
| 1 | Discovery | TravelOS source/schema (read-only) | `docs/TRAVELOS_CURRENT_IDENTITY_INVENTORY.md` (this phase, done) | Identity Platform team | Peer review against actual source | N/A — no state changed |
| 2 | Data profiling | Read-only query access to TravelOS's production/UAT database | A data-quality report: duplicate emails, orphaned rows, invalid tenants, etc. (§4 below names the exact checks) | Identity Platform team, TravelOS DBA | Report reviewed against §4's checklist | N/A — read-only |
| 3 | Identity reconciliation | Profiling report + `docs/TRAVELOS_IDENTITY_MAPPING.md` | `travelos_user_identity_map` populated, `migration_status` set per row | Identity Platform team | Every TravelOS `(tenantId, userId)` pair has exactly one map row; every CONFLICT row has a documented resolution (§5) | Truncate the map table; no TravelOS or Identity Platform production data yet touched |
| 4 | Tenant reconciliation | Profiling report | `travelos_tenant_identity_map` populated; new `Tenant` rows created in Identity Platform | Identity Platform team | Every TravelOS tenant maps to exactly one Identity Platform tenant; `tenantCode` collision-checked | Delete the newly-created Identity Platform `Tenant` rows (nothing in TravelOS was touched — they are net-new rows in a separate database) |
| 5 | Organization reconciliation | Tenant reconciliation output | New `Organization` rows in Identity Platform, one per TravelOS `Organization` (context fields only, per mapping doc §3) | Identity Platform team | Every TravelOS org (within a reconciled tenant) has exactly one Identity Platform org | Delete the newly-created Identity Platform `Organization` rows |
| 6 | Membership migration | User + Tenant + Organization reconciliation | `Membership` rows created, one per (global user, tenant, organization) combination observed in TravelOS `SecurityUserRole` | Identity Platform team | Every reconciled user has a Membership for every tenant they had a TravelOS `SecurityUser` row in | Delete the newly-created `Membership` rows |
| 7 | Product entitlement provisioning | Tenant reconciliation output + a per-tenant decision of which TravelOS product(s) (Travel/Healthcare/Fitness) that tenant actually uses | `Product` rows (one-time, platform-wide) + `TenantProductEntitlement` rows (per tenant) | Identity Platform team, informed by TravelOS's own tenant/subscription data | Every reconciled tenant has an entitlement matching what it's ACTUALLY subscribed to in TravelOS today (never auto-granted) | Delete the entitlement rows (Product rows may stay — they are platform-wide definitions, not tenant-specific) |
| 8 | Application registration | Architecture doc §8 | `Application` rows for `apps/web`, `apps/admin` (and, if confirmed needed, a ServiceAccount for backend jobs) | Identity Platform team + TravelOS team (redirect URIs, real audience values) | Manual verification against TravelOS's actual deployed frontend origins | Delete/disable the Application rows |
| 9 | Authentication coexistence | Phases 1-8 complete for at least one pilot tenant | TravelOS's OWN login endpoint still live; NEW/pilot-cohort users can also authenticate via Identity Platform | TravelOS team (adds Identity-Platform-aware login option) + Identity Platform team | A pilot user can complete Authorization Code + PKCE against Identity Platform and reach a TravelOS API successfully | Disable the Identity-Platform login option in TravelOS's frontend; legacy path is untouched and keeps working |
| 10 | User migration (cohort-by-cohort) | Coexistence live | Each cohort's users are told/prompted to use Identity Platform login; TravelOS's OWN password/session data for that cohort becomes dormant | TravelOS team (comms/UX) + Identity Platform team | Cohort's login success rate via Identity Platform tracked; TravelOS's own login attempt volume for that cohort trends to zero | Revert the cohort's UX prompt; legacy TravelOS login remains fully functional throughout |
| 11 | Token cutover (per cohort) | Cohort's users are migrated | TravelOS's resource-server code stops accepting TravelOS-self-issued tokens for that cohort's tenant(s); only Identity-Platform-issued tokens are accepted | TravelOS team | No legitimate user of that cohort is locked out; monitored error-rate does not spike | Re-enable TravelOS-self-issued token acceptance for that tenant (§ rollback semantics, §6 below, for what this actually means safely) |
| 12 | Legacy authentication shutdown | Every cohort cut over | TravelOS's own `authentication.service.ts` login/refresh endpoints are disabled (or removed) entirely | TravelOS team | Zero legacy login attempts observed over a sustained window before shutdown | Re-enable the legacy endpoints (code is not deleted until a further, separate decision — see change-control policy) |
| 13 | Validation | Full cutover | Production correctness validated per `docs/TRAVELOS_AUTH_CUTOVER_PLAN.md`'s own validation checklist | Both teams | Checklist 100% complete | N/A — validation only |
| 14 | Cleanup | Validation complete, a stated soak period elapsed | TravelOS's own `security_session`/`security_refresh_token`/legacy JWT code paths formally retired; migration mapping tables archived, not deleted (audit trail) | TravelOS team | Explicit sign-off | This is the one phase with no rollback — by design, it only happens after every earlier phase's own rollback window has closed |

Phases 3-8 concern Identity Platform data only (new rows in Identity Platform's own database) — **zero TravelOS database changes at any point**, consistent with the absolute isolation rule extending even into execution phases (2E.2+), not merely this architecture phase.

## 2. Zero-downtime evaluation (brief §38)

**Yes, achievable, with the strangler/cohort strategy** (`docs/TRAVELOS_INTEGRATION_ARCHITECTURE.md` §2's recommendation) — no phase above requires taking TravelOS offline:
- Phases 1-8 touch only Identity Platform's own database (new rows) and read-only TravelOS access — no TravelOS downtime.
- Phase 9 (coexistence) is additive — TravelOS's existing login keeps working unmodified while a new option is added.
- Phases 10-11 are per-cohort and reversible per-cohort (§6) — a defect discovered mid-cohort affects only that cohort, not the whole tenant base, and does not require downtime to remediate (revert that cohort's flag).
- Phase 12 (legacy shutdown) is the only phase that removes capability, and only after every cohort has already succeeded — a rolling, monitored decommission, not a downtime event.

**Mechanism**: per-tenant (or per-cohort-of-tenants) feature flag deciding whether that tenant's users are routed to TravelOS's legacy login or Identity Platform's login, and a corresponding flag in TravelOS's resource-server validator deciding whether that tenant's incoming tokens are checked against TravelOS's own legacy JWKS/key or Identity Platform's JWKS. Both flags exist in TravelOS's own configuration (never in Identity Platform, which must remain unaware of TravelOS's rollout state per the isolation rule).

## 3. Failure scenarios (brief §40)

| Scenario | Expected behavior | Security behavior | User behavior | Rollback behavior |
|---|---|---|---|---|
| Identity Platform unavailable | TravelOS's OWN legacy login (for not-yet-cutover cohorts) is unaffected; a cutover-cohort user cannot obtain a NEW token but an already-issued, unexpired one keeps working (JWKS is cached, `docs/RESILIENCE_AND_FAILURE_MODEL.md` §1) | Fail closed — no fallback to accepting an unsigned/unverified token | Cutover-cohort users see a login failure; legacy-cohort users unaffected | No rollback needed — this is a transient dependency outage, not a migration-state issue |
| TravelOS unavailable | Identity Platform is entirely unaffected (it has no dependency on TravelOS) | N/A | TravelOS users cannot reach TravelOS at all (unrelated to the migration) | N/A |
| Database unavailable (either side) | Each system's own existing behavior applies — Identity Platform's `/health/ready` reports 503; TravelOS's own equivalent (if any — not confirmed this pass) | Fail closed on both sides | Errors surfaced, no silent wrong answer | N/A — pre-existing behavior, unrelated to this migration |
| JWKS unavailable (TravelOS fetching Identity Platform's) | Cached key continues to validate already-known `kid`s; an unknown `kid` fails closed | Fail closed for unknown `kid` (`docs/RESILIENCE_AND_FAILURE_MODEL.md` §1, inherited unchanged) | Only affects a caller presenting a token signed with a `kid` TravelOS has never cached — rare, bounded by key-rotation cadence | N/A — transient |
| Network partition (TravelOS ↔ Identity Platform) | Same as JWKS unavailable, plus no new token issuance reachable from that TravelOS instance | Fail closed | Cutover-cohort logins fail; legacy-cohort unaffected | N/A — transient |
| Migration partially completed (e.g. Phase 6 in progress when interrupted) | Resume from `travelos_user_identity_map`'s own `migration_status` column — never re-run from scratch, never silently skip unresolved rows | No security exposure — no user is granted access before their own reconciliation row reaches RECONCILED | Migration operators see exactly which rows are PENDING/CONFLICT | Re-run the same phase; idempotent by construction (the map table's own PK prevents duplicate rows) |
| Duplicate user (same email, multiple TravelOS tenants) | Expected, handled by design (`docs/TRAVELOS_IDENTITY_MAPPING.md` §1/§4) — reconciles to one global SecurityUser + N Memberships | No cross-tenant data leakage — each Membership is independently RLS-scoped exactly like every other Identity Platform Membership | Each such person logs in once, globally, and can switch between their tenants like any other multi-tenant Identity Platform user | Reconciliation for that person can be individually reverted (delete their map rows + the Memberships created from them) without affecting anyone else |
| Duplicate tenant (two TravelOS tenants with colliding `tenantCode`) | Should not occur (TravelOS's own `tenantCode` is unique — inventory §4) — if found during profiling, it indicates a TravelOS data-integrity issue to raise with TravelOS's own team, not silently resolve unilaterally | N/A | N/A — blocks that tenant's reconciliation until resolved | N/A — not started until resolved |
| Invalid mapping (a map row pointing at a non-existent Identity Platform Tenant/SecurityUser) | Should be structurally impossible (FK constraints on the map tables) — a defect if it occurs | Fail closed — reconciliation halts | N/A | Fix the FK violation's root cause before resuming |
| Expired session (TravelOS legacy, mid-migration) | User is simply prompted to log in again — via whichever path (legacy or Identity Platform) is currently active for their cohort | No security impact | Normal re-login flow | N/A |
| Revoked user (disabled in TravelOS after their migration) | Must be re-disabled in Identity Platform too — **this requires an explicit, TravelOS-team-owned process step, not automatic**, since after cutover TravelOS no longer owns that user's authentication status; documented as a REQUIRED coexistence-window procedure, not solved by this architecture phase alone | A gap if not operationally handled — flagged as a Medium-severity process risk in §Known Issues of the final report | The disabled user should NOT be able to log in via Identity Platform if TravelOS's own tenant admin disabled them in TravelOS pre-migration but the corresponding Identity Platform account was never correspondingly disabled | Manually disable in Identity Platform if discovered |
| Suspended tenant | Entitlement/tenant-status checks at Identity Platform's own token-issuance layer already deny (unchanged Identity Platform behavior) | Fail closed, unchanged | Every user of that tenant is denied uniformly | N/A |
| Revoked entitlement | `TenantProductEntitlement` check at issuance denies (unchanged) | Fail closed | Same | N/A |
| Wrong organization | Rejected — validated principal's own `organizationId`, never trusted from elsewhere (unchanged Identity Platform + unchanged TravelOS behavior, §9 of architecture doc) | Fail closed | User denied access to the wrong organization's data | N/A |
| Legacy TravelOS token presented after that cohort's cutover | TravelOS's resource-server validator no longer trusts TravelOS's own old signing key for that tenant — rejected as `invalid_token` | Fail closed — this is the explicit point of cutover | User is prompted to re-authenticate via Identity Platform | Reverting cutover (§6) re-enables acceptance temporarily, but never "trust old tokens indefinitely" (brief's own explicit prohibition) |
| Identity Platform token presented to a not-yet-cutover TravelOS API instance | Rejected — that instance's validator doesn't yet trust Identity Platform's JWKS at all until its own cutover flag flips | Fail closed | User (on the new path prematurely) is denied; expected during the coexistence window if a cohort boundary is crossed inconsistently — a coordination bug to fix, not a security gap | Ensure cutover flags are consistent per-tenant across all TravelOS instances before enabling |

## 4. Data quality checklist (brief §37 — profiling only, no TravelOS mutation)

To be executed in Phase 2 (Data Profiling) above, against read-only TravelOS access:

```text
duplicate emails across tenants (EXPECTED — see §3 duplicate-user handling, not itself an error)
invalid/malformed emails
duplicate SecurityUser rows within the SAME tenant (should be impossible — unique constraint — flag if found, indicates a constraint bypass)
orphaned security_user_role rows (roleId/userId/organizationId pointing at deleted parents)
orphaned Membership-equivalent data
invalid/inactive tenants (status values not yet enumerated — inventory §"UNKNOWN")
inactive tenants with active users (a tenant suspended but its users still show lastLoginAt recently — a business question to raise with TravelOS's own team, not resolved by Identity Platform unilaterally)
duplicate organizationCode within a tenant (should be impossible — unique constraint)
invalid role assignments (SecurityUserRole referencing a deleted role/permission)
broken foreign keys generally (soft-delete columns mean a "deleted" parent row may still be referenced — verify deletedAt handling doesn't already cause this in TravelOS's own queries, which is a TravelOS-internal concern, not something this migration fixes)
stale sessions / expired refresh tokens (irrelevant to migrate — confirmed not migrated, §5 of architecture doc)
```

No TravelOS mutation is proposed to fix any of the above — this checklist produces a **remediation plan** (who needs to fix what, and whether it blocks a given tenant's/user's reconciliation) for TravelOS's own team to act on, or for the reconciliation logic to explicitly special-case (e.g., a CONFLICT status for the affected map row rather than silently discarding the person).

## 5. Conflict resolution strategy (brief §18)

For a duplicate email across N TravelOS tenants:
1. If all N TravelOS `SecurityUser.passwordHash` values verify to the SAME Argon2id hash bytes: reconcile confidently to one global SecurityUser, N Memberships, `migration_status = RECONCILED`.
2. If the hashes differ (the person set different passwords in different tenants — plausible if they never realized it was "the same" cross-tenant identity): `migration_status = CONFLICT`, held for manual resolution — pick the most-recently-active tenant's hash as the reconciled global password AND force a password-reset email to the person notifying them of the merge, rather than silently guessing which password they'd expect to still work.
3. If profile data conflicts (different `firstName`/`lastName` per tenant): reconcile identity regardless (email is what unifies a global Identity, `docs/IDENTITY_DOMAIN_MODEL.md`-equivalent precedent already established in Identity Platform's own Phase 2A design) — profile fields are cosmetic, not a blocker; the most-recently-updated value wins, documented as such.

No user is silently discarded — every TravelOS `(tenantId, userId)` row produces a `travelos_user_identity_map` row with an explicit status, RECONCILED or CONFLICT, never simply omitted.

## 6. Rollback semantics (brief §39)

**Explicit rule, per the brief**: rollback never means "trust old (TravelOS-self-issued) tokens indefinitely again." Each stage's rollback is:

```text
Before dual auth:        nothing to roll back — no state changed yet
During dual auth:        disable the Identity-Platform login option in TravelOS's frontend; TravelOS's own
                          legacy path was never disabled, so this is a pure feature-flag flip, not a data change
During user migration:   pause further cohort prompts; already-migrated users' Identity Platform accounts
                          remain valid (they are NOT reverted) — they simply keep using Identity Platform,
                          since their TravelOS legacy credentials still work in parallel throughout
                          coexistence; only the PROMPT to migrate is paused for not-yet-migrated users
During token cutover:    re-enable TravelOS's OWN validator accepting TravelOS-self-issued tokens for the
                          affected tenant(s) ONLY, for a bounded, explicitly time-boxed re-extension —
                          never indefinite, and the decision to do so is itself a logged, audited action
After cutover:           same as "during token cutover" — reverting is still possible until Phase 12
                          (legacy shutdown) actually removes the legacy code path
After legacy shutdown:   no rollback — by design (§1, Phase 14's own note); this is why every earlier
                          phase's rollback window must be exhausted (soak period, explicit sign-off)
                          before Phase 12 is ever executed
```
