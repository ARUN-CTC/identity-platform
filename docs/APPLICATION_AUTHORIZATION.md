# Application Authorization: Scopes, Permissions, and Entitlement Composition

Detail document for ADR-016/ADR-020. Answers the brief's central distinction: *what may this application call* vs. *what may this user/service actually do*.

## 1. The four independent gates

A single API request, once OAuth is implemented, must pass **all four** of the following — each answers a genuinely different question, each is owned by a different party, and none substitutes for another:

```text
Application trusted for this API   (OAuth: is this client even registered
        │                            for this audience/resource?)
        AND
Required OAuth scope granted       (OAuth: did the client request, and was
        │                            it granted, the scope this operation
        │                            needs? — "what may this APPLICATION call")
        AND
User/Service authorization         (IAM: does THIS principal have the
        │                            permission this operation needs? —
        │                            "what may this USER/SERVICE actually do"
        │                            — product-local, ADR-004)
        AND
Organization/Tenant context        (Phase 2C, unchanged: is the acting
        │  + Product Entitlement     context valid, and is the tenant
        │                            entitled to this product at all?)
        ▼
                    REQUEST AUTHORIZED
```

## 2. Worked example

```text
Application scope:   travelos.write        (the TravelOS Web app is allowed
                                              to request write operations
                                              at all — an OAuth-level fact
                                              about the CLIENT)

User permission:     BOOKING_CREATE          (this specific user, in this
                                              organization, holds a role
                                              granting BOOKING_CREATE — an
                                              IAM-level fact about the USER,
                                              namespaced under travelos.*
                                              per ADR-004, enforced by
                                              TravelOS's own API, never by
                                              the Identity Platform)
```

A user with `BOOKING_CREATE` using a client that was never granted `travelos.write` is denied at the scope gate — the *application* wasn't trusted for that operation, regardless of what the *user* could otherwise do. A client holding `travelos.write` acting on behalf of a user with no `BOOKING_CREATE` grant is denied at the permission gate — the application is trusted, but this specific user isn't authorized. Both gates must pass; neither implies the other.

## 3. Why this separation is structural, not incidental

OAuth scope answers a question about **delegation boundaries** the client itself asked for and the user (or, for a first-party client, the platform operator registering it) agreed to grant — it exists to bound what a *compromised or misbehaving client* could do even while holding an otherwise-valid, correctly-authenticated user's token. IAM permission answers a question about the **user's own standing** within the organization — entirely independent of which client happens to be presenting their credentials this time. Collapsing the two (e.g., treating "has the `travelos.write` scope" as sufficient authorization) would mean any client a user happens to authorize inherits that user's *full* permission set rather than being bounded to what it was actually granted — exactly the escalation this separation exists to prevent.

## 4. Product entitlement remains its own, third thing

`TenantProductEntitlement` (ADR-011, unchanged) answers neither of the above — it answers "is this **tenant** commercially/administratively entitled to this product at all," independent of any specific user's permissions or any specific client's scopes. A tenant with a revoked entitlement denies every user and every client uniformly, regardless of scope or permission — checked as its own gate (ADR-020 step 9), never folded into scope or permission evaluation.

## 5. Where each check happens

| Check | Owner | Where | Cached? |
|---|---|---|---|
| Application trust / audience | Identity Platform (issuance) + resource server (validation) | Token issuance denies an unregistered scope request; resource server validates `aud` locally | N/A — structural, per-token |
| OAuth scope | Identity Platform (issuance) + resource server (validation) | Granted at `/authorize`/`/token`; checked locally via the `scope` claim | No — local, per-request, from the token itself |
| IAM permission | The **product itself** (ADR-004) | Product's own resource-server code, using its own namespaced permission catalog | Product's own choice |
| Organization/Tenant context | Identity Platform (issuance + live re-validation) | Token claims + `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md`'s existing, unchanged mechanism | No — re-validated live on every refresh |
| Product entitlement | Identity Platform (`ProductAccessService`) | Either the Identity Platform (if a product calls back) or the resource server via a short-TTL cache | Optional, product's choice (ADR-020 step 9) |

## 6. Application credential lifecycle

```text
Create   → Application registered by a Platform Operator (existing mechanism,
            Phase 2B) — clientId generated, clientSecret generated and shown
            EXACTLY ONCE in plaintext at creation, stored only as a hash
            thereafter (existing: clientSecretHash). PUBLIC clients receive
            no secret at all (existing: clientType).
Activate → status = ACTIVE (existing) — the application may request tokens.
Rotate   → a NEW secret is generated and shown once; the OLD secret remains
            valid for a bounded overlap window (existing columns:
            secretCreatedAt for the new one, secretRevokedAt marks when the
            old one's grace period ends) — never an instantaneous cutover,
            which would break any in-flight deployment still holding the old
            secret.
Expire   → (conceptual, future) a secret may carry its own expiry independent
            of explicit rotation, forcing periodic rotation as policy rather
            than only as an incident response.
Revoke   → secretRevokedAt set immediately (existing mechanism) — an
            emergency action, distinct from routine rotation's overlap
            window: revocation is effective immediately, no grace period.
Disable  → Application.status set to a disabled value (existing mechanism) —
            every future token request is rejected at issuance; does not
            retroactively invalidate already-issued, unexpired tokens (bounded
            by their own short TTL — see docs/AVAILABILITY_MODEL.md).
Delete   → not currently supported for Application (no delete endpoint exists,
            Phase 2B) — disabling is the supported "this application should
            never be used again" action; hard deletion of a row with a
            historical audit trail is deliberately not offered, consistent
            with how Membership/Organization already treat removal as a
            status, not a deletion (docs/PHASE_2A.md).
```

**Secret display policy**: a plaintext secret is visible exactly once, in the HTTP response to the create/rotate call that generated it — never logged, never retrievable again, never displayed in any list/read endpoint (existing Phase 2B behavior, reaffirmed, unchanged).

**Audit events**: `APPLICATION_CREATED`, `APPLICATION_SECRET_ROTATED`, `APPLICATION_SECRET_REVOKED`, `APPLICATION_DISABLED` (existing/extended from Phase 2B's audit catalog) — every credential lifecycle action is a Platform Operator action, audited with `scope='PLATFORM'` exactly as Product/Application administration already is.

**Operator permissions**: unchanged — `APPLICATION_MANAGE` (Phase 2B, platform-only), no new permission model introduced by this document.

## 7. Implementation status (Phase 2D.2, `docs/PHASE_2D2.md`)

**Built**: `grantTypes`, `allowedScopes`, `audiences`, `tokenEndpointAuthMethod` are now real, deny-by-default `Application` columns, each with its own dedicated, reusable policy class (`src/modules/applications/policies/`) — `ApplicationGrantPolicy`, `ApplicationScopePolicy`, `ApplicationAudiencePolicy`, `RedirectUriPolicy`, `OriginPolicy`, `TokenEndpointAuthMethodPolicy` — and one composed facade, `OAuthApplicationPolicyService` (§1's table above, "where each check happens"), that a future `/authorize`/`/token` implementation calls instead of re-deriving these rules. Registration/update-time validation (namespace ownership for scopes, wildcard rejection for audiences/redirect-URIs/origins, the PUBLIC+`client_credentials` and `authorization_code`-without-a-redirect-URI contradictions) is enforced by `ApplicationsService`, calling the same policy classes — never a second, divergent copy of any rule.

**Not built**: no scope-management admin UI/API beyond the existing Product/Application registration endpoints (extended, not replaced, by this phase); automatic secret expiry (rotation remains a manual operator action); no `/authorize`/`/token` endpoint actually evaluates these policies yet — `OAuthApplicationPolicyService.checkEligibility()` is exercised directly today only by its own tests and by `tests/phase2d2-application-oauth-client.e2e-spec.ts`.

## 8. Implementation status (Phase 2D.3, `docs/PHASE_2D3.md`)

**Built**: `ServiceAccount` (`src/modules/service-accounts/`) — the machine-identity model this document's `Application 1───N ServiceAccount` relationship (§1) previously described only in the abstract — now registers under an `Application`, ownership immutable after creation, credential hashed with the same utility Application's own `client_secret` uses but as a structurally distinct secret value. `ServiceAccountTenantGrant` implements the per-tenant authorization layer this document's model always required underneath `TenantProductEntitlement` (§1's pipeline). Neither `ServiceAccount` nor `ServiceAccountTenantGrant` is consulted by `OAuthApplicationPolicyService.checkEligibility()` yet — that composition remains future work for whichever phase actually builds the Client Credentials `/token` flow.

**Not built**: the `client_credentials` grant flow itself, any composed eligibility check spanning Application + ServiceAccount + ServiceAccountTenantGrant + TenantProductEntitlement, and a cross-tenant "list all grants for a ServiceAccount" convenience endpoint (deliberately deferred — see `docs/PHASE_2D3.md`'s own dedicated section on that decision).
