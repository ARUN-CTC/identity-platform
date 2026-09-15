# ADR-018: Application Trust Model and Client Types

## Context

ADR-009 decided `Application` *is* the OAuth client — no separate `Client` table — and flagged its own risk: "If OAuth2/OIDC adoption later needs a real distinction... this decision may need revisiting." Phase 2D is that revisiting. The current `application` table (`database/ddl/005_product.sql`, Phase 2B) already carries `clientType` (`CONFIDENTIAL` | `PUBLIC`), `redirectUris`, `allowedOrigins` — explicitly marked "reserved for future OAuth2/OIDC use" at creation time — and `create-application.dto.ts`'s own comment already pre-decided that a service-to-service caller is a **separate** future `ServiceAccount` entity that *references* an Application, not a client-type variant of Application itself.

## Problem

Determine, now that real OAuth2.1 flows (authorization_code+PKCE, client_credentials) are being architected, whether `Application` still suffices as the sole client entity, or whether OAuth's distinct concerns (a registered app's identity vs. its specific credential/redirect-URI configuration) finally require a split.

## Options

1. **Split `Application` into `Application` (grouping) + `Client` (credential/redirect-URI holder)**, as ADR-009 itself once considered and rejected. Revisit only if a real requirement for *multiple simultaneous credential/redirect-URI sets per logical app* appears.
2. **Keep one `Application` entity**, extend it with the additional OAuth-specific attributes conceptually required (grant types, scopes, audiences, token-endpoint auth method) rather than splitting entities.

## Decision

**Option 2 — ADR-009 stands, reaffirmed.** No project in the current roadmap (TravelOS, Healthcare, Gym) needs more than one live credential/redirect-URI set per logical Application at a time (zero-downtime dual-secret rotation is handled by `secretCreatedAt`/`secretRevokedAt`'s overlap window, not by a second credential row — `docs/APPLICATION_AUTHORIZATION.md` §Credential lifecycle). `Application` gains additional conceptual attributes (not implemented in Phase 2D):

```text
Product
 └── Application (== OAuth "client")
      ├── applicationType         (existing clientType: CONFIDENTIAL | PUBLIC)
      ├── tokenEndpointAuthMethod (derived from applicationType: client_secret_basic/post for CONFIDENTIAL, "none" for PUBLIC)
      ├── redirectUris            (existing column — becomes enforced, exact-match only, ADR-013)
      ├── allowedOrigins          (existing column — CORS enforcement for browser-based flows)
      ├── grantTypes              (NEW, conceptual: subset of {authorization_code, refresh_token, client_credentials})
      ├── allowedScopes           (NEW, conceptual: which OAuth scopes this Application may ever request)
      ├── audiences               (NEW, conceptual: which resource API(s) this Application's tokens may target)
      ├── status                  (existing)
      └── credentials             (existing: clientId, clientSecretHash, secretCreatedAt/RevokedAt)
```

A **service** principal remains, per ADR-009's own prior note, a *separate future entity* — `ServiceAccount` — that references an `Application` (typically one with `grantTypes: [client_credentials]` and no `redirectUris`) rather than a variant client type. `ServiceAccount` is the service's own principal identity (analogous to `security_user` for humans); `Application` remains the registered OAuth client through which either a human (via authorization_code) or a service (via client_credentials, through its `ServiceAccount`) is authenticated.

## Rationale

Every new attribute above is a column on the existing row, not a reason to introduce a join — the same reasoning ADR-009 already used. Splitting entities to accommodate OAuth would mean maintaining two rows with a 1:1 relationship and no independent lifecycle for either, the exact indirection ADR-009 rejected. The `ServiceAccount`-as-separate-entity design was already implicit in Phase 2B's own DTO comments; this ADR makes it explicit and permanent rather than merely a comment.

## Security implications

`tokenEndpointAuthMethod` derived strictly from `applicationType` (never independently settable) prevents a PUBLIC client from being accidentally configured to present a secret it cannot keep confidential (a client secret embedded in a distributed SPA/mobile binary is not a secret at all — `docs/OAUTH_ARCHITECTURE.md` §Public vs confidential). `grantTypes` being an explicit allow-list (not "any grant this client asks for") prevents an Application registered for `authorization_code` from being silently usable for `client_credentials` it was never intended to hold.

## Operational implications

Existing Applications (Phase 2B/2B.1/2B.2 data) require no migration under this ADR — `redirectUris`/`allowedOrigins` already exist and are simply unenforced; `grantTypes`/`allowedScopes`/`audiences` are new, additive columns with safe defaults (e.g. an existing CONFIDENTIAL application defaults to `grantTypes: [client_credentials]` until an operator explicitly registers `authorization_code` support with real redirect URIs).

## Consequences

Platform Operators (ADR-010, unchanged boundary) register and edit these new attributes via the existing Product/Application admin surface (`docs/PRODUCT_REGISTRATION.md`), extended — not replaced — by this design.

## Deferred considerations

`ServiceAccount`'s own schema, lifecycle, and admin API are not designed in full here — this ADR fixes only its *relationship* to `Application` (references it, is not a variant of it). Full `ServiceAccount` design is sequenced alongside Client Credentials implementation (`docs/PHASE_2D_ARCHITECTURE.md` §Implementation Roadmap, 2D.10).

## Gate Review Amendment (Phase 2D Architecture Gate — Gate 3)

**This amendment reverses the `ServiceAccount`-as-separate-entity conclusion above.** The original decision inferred a separate entity from a Phase 2B DTO comment (`create-application.dto.ts`: "a service-to-service caller is a ServiceAccount... not a variant of Application/client type itself") without independently re-testing that inference against a concrete requirement — exactly the "convention over justification" trap `docs/PHASE_2D_ARCHITECTURE.md`'s own simplification rule (§16 of the Gate Review brief) warns against. Re-examined against real cases:

- **One product, multiple independent backend services** (e.g. "TravelOS Sync Service" + "TravelOS Full Backend"): already fully solved by registering **multiple `Application` rows** under one `Product` — exactly how "TravelOS Web"/"TravelOS Mobile"/"TravelOS Backend" already coexist today (Phase 2B). No separate principal entity is needed for this case.
- **Credential isolation**: already provided by `Application`'s own `clientId`/`clientSecretHash` — a `ServiceAccount` referencing an `Application` would use the *same* credential, adding no isolation of its own.
- **Service-specific authorization (tenant grants)**: can be keyed directly by `Application.id` — no need for an intermediate identity to hang a grant off of.
- **Different lifecycle**: an Application's own lifecycle (create/activate/rotate/revoke/disable, `docs/APPLICATION_AUTHORIZATION.md` §6) already *is* the lifecycle a service identity needs — not a different one.
- **Different audit identity**: `Application.id`/`clientId` already serves as a perfectly good audit-actor identity — Platform-level audit already attributes Application lifecycle events to the Application itself today.

**No re-examined case demonstrates a real requirement `Application` alone cannot satisfy.** This is precisely the same test ADR-009 already applied to reject a separate `Client` entity ("nothing distinguishes them operationally yet") — applying it consistently here yields the same answer.

**Revised decision: no separate `ServiceAccount` entity.** `Application` is simultaneously the OAuth client *and* the service principal for any Application whose `grantTypes` includes `client_credentials`. A service-issued access token's `sub` = `Application.id` directly (`docs/TOKEN_AND_SCOPE_ARCHITECTURE.md`, amended). `ServiceAccountTenantGrant` (ADR-015) is renamed **`ApplicationTenantGrant`**, keyed by `Application.id`. This does not reopen `clientType` (`CONFIDENTIAL`/`PUBLIC` remain the only two values, governing redirect-flow credential handling only, unchanged, consistent with the original Phase 2B comment's actual point — service auth was never a third *clientType*) — it only removes a second, unnecessary *principal* entity layered on top.

**Security implication of the simplification, not a cost of it**: `Application` is a platform-level entity (no `tenant_id`, no RLS, no possible foreign-key path to `membership.user_id`, a different ID namespace and table entirely from `security_user`) — collapsing the service principal into it makes "a service identity cannot silently inherit human memberships" (non-negotiable principle) **structurally impossible to violate** even more directly than a separate `ServiceAccount` would have, since there is now no additional entity that could ever be mistakenly joined to `membership` at all.

**Preserved for the future**: if a genuine requirement for *multiple independent service principals sharing one Application's credential* ever appears (the one case that would justify a split), it is met by evolving `Application` into a grouping role and introducing a child table then — additive, not breaking, exactly as ADR-009's own deferred-risk clause already anticipated for the client-splitting question generally.

## Gate Review Correction — retracting the amendment above

**The amendment immediately above is retracted.** It was reached by testing `ServiceAccount` only against the cases this ADR itself enumerated, without first checking whether an *existing, already-approved* document had already settled the question with a case this ADR's own re-examination failed to consider. `docs/PRODUCT_REGISTRATION.md` §2.4 and §3, and ADR-005 §Decision ("Four separate entities... related but independently evolvable... `ServiceAccount`s are added per automation need"), already establish an explicit **`Application 1───N ServiceAccount`** cardinality: *one* registered Application (one product-facing client surface, e.g. "TravelOS Backend," one `client_id`/`client_secret`) commonly runs *many* independent automated processes (a nightly batch job, a webhook processor, a data-sync cron) — each warranting its own distinct machine identity for audit attribution and scope/tenant-grant narrowing, without each needing its own full Application registration (which would mean provisioning a redundant `client_id`/`client_secret`/redirect-URI/CORS configuration per cron job — none of which is a meaningful per-job concept; those attributes belong to the *client surface*, not to each automated process running behind it). This is precisely the "multiple independent backend services under one product" case the retracted amendment addressed too narrowly (only at the Application-per-surface granularity, missing the finer Application-per-automation-job granularity `docs/PRODUCT_REGISTRATION.md` had already identified).

**Restored decision: `ServiceAccount` stands as a genuinely separate entity, exactly as ADR-005/ADR-006/`docs/PRODUCT_REGISTRATION.md` §2.4 already designed it** — `ServiceAccount` belongs to exactly one `Application` and authenticates using that Application's own `client_id`/`client_secret` (no separate credential of its own); `sub` on a service-issued access token = `ServiceAccount.id` (not `Application.id`); `ServiceAccountTenantGrant` (ADR-015) is keyed by `ServiceAccount.id`, preserving the fine-grained, per-automation tenant-scoping that is the entire reason `ServiceAccount` exists as its own row rather than being collapsed into `Application`. The "structural, not conventional" argument for why this cannot silently inherit human Memberships (§Security implications of the simplification, above) still holds unchanged: `ServiceAccount`, like `Application`, is a platform-level entity with no possible foreign-key path to `membership.user_id`.

**What this correction demonstrates, and why it is left in place rather than silently fixed**: a rigorous gate review must check a proposed simplification against the *complete* existing architecture record, not only against the document proposing the simplification — this is exactly the failure mode `docs/PHASE_2D_ARCHITECTURE.md`'s own gate-review completion standard exists to catch before implementation, and this correction is the demonstration that the check works, not evidence the process failed.
