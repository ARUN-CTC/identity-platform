# Product Onboarding — UX Design & Validation

Phase 2UI.1. The reusable "Onboard Product" wizard design, and its validation against all three target products (TravelOS, CTC Banking Intelligence AI, QueueStream.health) plus one hypothetical future product (GymOS). Builds directly on `docs/NEW_PRODUCT_ONBOARDING_WALKTHROUGH.md` — that document is the source of truth for the underlying API mechanics (every request/response shape, every real error this wizard must handle); this document is the UX layer on top of it.

## 1. The wizard, corrected against what actually happens live

The brief's own proposed step list (§16) is: `Product Information → Application → OAuth Configuration → Redirect URIs → Scopes → Review → Complete`. **This step list is incomplete** — verified by actually running the flow (`docs/NEW_PRODUCT_ONBOARDING_WALKTHROUGH.md` §4.2): an `/oauth/authorize` request against an Application with no registered `audiences` is rejected with `400 audience is required` every single time, unconditionally. Without a dedicated step for it, every product onboarded through this wizard would be silently broken at first real login attempt, and the operator would have no idea why until debugging a live 400 from a redirect URL.

**Corrected step list**:

```text
1. Product Information    (name, slug, description)
2. Application             (name, client type: CONFIDENTIAL | PUBLIC)
3. OAuth Configuration      (grant types: authorization_code, client_credentials)
4. Redirect URIs            (required if authorization_code is checked)
5. Scopes                   (openid/profile/email + this product's own namespaced scopes)
6. Audiences                (** NEW STEP — resource-API identifier(s) this Application may
                              request a token for; without this, step 3's authorization_code
                              grant cannot ever complete a real login)
7. Review                   (read-only summary of everything above)
8. Complete                 (one-time client secret reveal via the existing OneTimeSecretDialog
                              — CONFIDENTIAL clients only; PUBLIC clients show a plain confirmation,
                              no secret exists to reveal)
```

Each step's fields map 1:1 to `CreateProductDto`/`CreateApplicationDto`/`UpdateApplicationDto` (audiences is a `PATCH` after creation today, per the gap analysis — see §2) — no new backend field is invented for this wizard; it only sequences existing DTOs into a guided flow instead of the current two-screen (Register Product, then separately Register Application) experience.

## 2. One implementation note: Audiences requires a second call today

`CreateApplicationDto` does not accept `audiences` at creation time — confirmed live in the walkthrough (`docs/NEW_PRODUCT_ONBOARDING_WALKTHROUGH.md` §2, "Registering the resource-API audience": the field is empty on creation, set via a follow-up `PATCH /applications/:id`). The wizard's step 6 therefore issues a second network call after step 2/3/4/5's `POST .../applications` succeeds, before showing step 7's review — this should be invisible to the operator (one wizard, two calls under the hood), not surfaced as "step 6 failed, retry" if step 2 already succeeded; the wizard's own state should track "Application created, audiences not yet set" as a resumable partial state rather than forcing a full restart on a transient failure between the two calls.

## 3. Multi-application products

Brief §15's example (`TravelOS Web`) and the domain reality of all three target products means the wizard needs a **"register another Application"** loop, not a strictly linear one-Application-per-product assumption — after step 8 (Complete) for the first Application, offer "Add another Application to this Product" (returns to step 2 with Product Information pre-filled and skipped) before the operator leaves the flow. This isn't a new capability — `POST /products/:productId/applications` already supports being called any number of times — it's purely a wizard-navigation decision, made because every one of the three real target products needs more than one Application (see §4-6).

## 4. Scenario A — Onboard TravelOS

| Wizard input | Value | Notes |
|---|---|---|
| Product name / slug | TravelOS / `travelos` | TravelOS already has its own deep integration plan — `docs/TRAVELOS_INTEGRATION_ARCHITECTURE.md`, `docs/adr/ADR-022-travelos-identity-integration.md` — this wizard is the UX for the "Application topology" that plan already specifies, not a redesign of it |
| Applications | `TravelOS Web` (CONFIDENTIAL, `authorization_code`), possibly `TravelOS Backend Service` (CONFIDENTIAL, `client_credentials`, for its own service-to-service calls) | Matches the existing plan's own topology decision — see ADR-022 |
| Scopes | `openid`, `profile`, `email`, `travelos.booking.read`, `travelos.booking.write`, etc. (TravelOS's own namespace, TravelOS's own team registers exactly which codes it needs) | Identity Platform never authors these — confirmed by `docs/PRODUCT_REGISTRATION.md`'s own ownership split |
| Audiences | `travelos-api` (TravelOS's own resource-server identifier) | TravelOS's own backend validates this via `ExternalBearerAuthGuard`-equivalent code, same pattern as the walkthrough's Fleet Manager example |
| Tenant entitlement | One `TenantProductEntitlement` per real TravelOS customer tenant | Bulk — TravelOS likely has many existing tenants to entitle at once; **Gap Analysis §3 confirms no bulk-entitlement endpoint exists** — this is the one real friction point for TravelOS specifically, since it's the product with an existing customer base to migrate, not a from-zero onboarding. Flagged as a P1 consideration specific to TravelOS's migration, not a P0 blocker (N sequential calls work, just slower). |

**Validation result**: fully supported by the wizard as designed, once Audiences (step 6) exists. TravelOS's own separate migration plan (`docs/TRAVELOS_IDENTITY_MIGRATION_PLAN.md`) governs the *user/tenant data* migration, which this wizard does not touch — this wizard only covers TravelOS's Product/Application registration, a small piece of that larger plan.

## 5. Scenario B — Onboard CTC Banking Intelligence AI

| Wizard input | Value | Notes |
|---|---|---|
| Product name / slug | CTC Banking Intelligence AI / `ctc-banking-ai` | |
| Applications | `Banking AI Web` (CONFIDENTIAL, `authorization_code` — human analysts/staff logging in), `Banking AI Analytics Engine` (CONFIDENTIAL, `client_credentials` — its own backend/AI pipeline authenticating as a Service Account, not a human) | A banking-analytics product plausibly has more machine-to-machine traffic (scheduled analysis jobs, report generation) than the other two — this is exactly what `client_credentials` + a Service Account is for, already fully supported (§3.4 of the UX Architecture doc) |
| Scopes | `openid`, `profile`, `email`, `ctc-banking-ai.reports.read`, `ctc-banking-ai.insights.read`, etc. | Namespaced under its own slug, same mechanism as every other product — no Identity Platform change |
| Audiences | `ctc-banking-ai-api` | |
| Security posture note | Higher-sensitivity data (financial) is a reason for *this product's own team* to consider requiring `CONFIDENTIAL` clients only (no `PUBLIC`/PKCE-only Applications) and tighter token TTLs via its own operational choices — **not** a reason for Identity Platform itself to treat this product specially; the platform's mechanism is identical for every product, per `docs/MULTI_PRODUCT_INTEGRATION.md` §2's own precedent for why Healthcare's higher sensitivity doesn't change the platform's own code | This is a **product-side configuration choice**, expressed entirely through which wizard options its own admin picks (CONFIDENTIAL vs PUBLIC, which scopes) — no new Identity Platform capability is needed to support it |

**Validation result**: fully supported, zero backend gaps, zero UX gaps beyond the same Audiences-step correction (§1) and the same optional bulk-entitlement friction (§4) if Banking AI also has a pre-existing tenant base to migrate.

## 6. Scenario C — Onboard QueueStream.health

| Wizard input | Value | Notes |
|---|---|---|
| Product name / slug | QueueStream.health / `queuestream-health` | |
| Applications | `QueueStream Staff Web` (CONFIDENTIAL, `authorization_code` — clinic staff), `QueueStream Kiosk` (**PUBLIC**, `authorization_code` + PKCE — a waiting-room kiosk/tablet is exactly the "can't keep a secret" case PUBLIC clients exist for), `QueueStream Notification Service` (CONFIDENTIAL, `client_credentials` — automated queue-position notifications) | Three distinct Application shapes, all already-supported client-type/grant-type combinations — no new client type or grant type is needed |
| Scopes | `openid`, `profile`, `email`, `queuestream-health.queue.read`, `queuestream-health.queue.write`, etc. | |
| Audiences | `queuestream-health-api` | |
| Health-data sensitivity note | Same reasoning as Banking AI (§5) — QueueStream's own team decides its own token TTLs/client-type posture; Identity Platform's mechanism doesn't change. This document does not attempt to reason about HIPAA or health-data-specific compliance requirements — that's explicitly out of scope for an Identity/authentication platform and belongs entirely to QueueStream's own product-domain responsibility, per the ownership boundary (§2/§23 of the original brief). | |

**Validation result**: fully supported. This scenario is the best evidence that PUBLIC/`authorization_code`+PKCE clients (needed for the kiosk) work exactly the same way they did in the live walkthrough's own worked example (which used a PUBLIC client throughout) — no product-specific accommodation was needed.

## 7. Scenario D — GymOS (future-product test)

Simulating "create a completely new SaaS product called GymOS" with no advance design work, to test whether the platform genuinely needs zero Identity Platform changes:

1. Platform Operator opens the (already-existing, unmodified) Onboard Product wizard.
2. Product Information: `GymOS` / `gymos` / "Gym membership and class-booking platform."
3. Application: `GymOS Web`, CONFIDENTIAL, `authorization_code`.
4. Redirect URIs: `https://app.gymos.example/callback`.
5. Scopes: `openid`, `profile`, `email`, `gymos.membership.read`, `gymos.classes.book` — GymOS's own team invents these namespaced codes; Identity Platform never validates their meaning, only that they're syntactically well-formed and namespace-prefixed.
6. Audiences: `gymos-api`.
7. Review → Complete → one-time secret reveal.
8. Platform Operator grants whichever tenant(s) are GymOS customers a `TenantProductEntitlement`.
9. GymOS's own backend team implements a resource server using the same generic `ExternalBearerAuthGuard`-equivalent pattern documented in `docs/RESOURCE_SERVER_ARCHITECTURE.md` and demonstrated live in the walkthrough's §5 — this is GymOS's own code, running in GymOS's own deployment, never inside this repository.

**Result: YES — zero Identity Platform code, schema, or deployment change required.** Every field GymOS needs (name, slug, scopes, redirect URIs, audiences) is operator-supplied configuration through the same wizard every other product uses. This is the direct, concrete answer to the brief's own Success Criterion #7 ("Can a new product be onboarded without redesigning Identity?") — **yes**, confirmed by simulation against the real, unmodified API surface, not asserted from architecture diagrams alone.

## 8. What this validation exercise did NOT find

No product-specific UI, business rule, or schema field was needed for any of the four products above — including the two (Banking AI, QueueStream) with real domain-specific sensitivity (financial data, health data). Every difference between them (which grant types, which client types, how many Applications, what their scopes are named) is expressed entirely as **configuration**, never as a code branch inside this repository. This is the empirical confirmation of brief §2/§3's central architectural principle: the boundary held under actual, worked-through simulation, not just in the diagram.

The one genuine friction point found — bulk tenant entitlement for a product with a pre-existing customer base (relevant to TravelOS specifically, §4) — is a missing convenience endpoint, not a boundary violation; N sequential calls through the existing single-item endpoint still work today, just slower for a large existing tenant base.
