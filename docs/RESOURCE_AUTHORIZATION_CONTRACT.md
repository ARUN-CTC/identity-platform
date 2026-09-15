# Resource Authorization Contract

Phase 2D.6 (`docs/PHASE_2D6.md`) — the reusable contract between the Identity Platform's trust boundary (Phase 2D.5) and a Product Resource Server's own authorization decision. Builds on, and never modifies, `docs/RESOURCE_SERVER_ARCHITECTURE.md` (Phase 2D.5's `AuthenticatedExternalPrincipal`/`ResourceAuthorizationContext`/`ExternalBearerAuthGuard`).

```text
Identity Platform
      │
Authentication / Trust
      │
      ▼
AuthenticatedExternalPrincipal
      │
      ▼
ResourceAuthorizationContext
      │
┌─────┴─────┐
│           │
Product      OAuth
Entitlement  Scope
│           │
└─────┬─────┘
      ▼
PRODUCT RESOURCE SERVER
      │
      ▼
Product IAM
      │
      ▼
Resource Policy
      │
      ▼
Protected API
```

## 1. Authentication vs. authorization

Authentication (Phase 2D.5, unchanged) answers *"is this token valid, and who does it represent?"* — `ExternalBearerAuthGuard`. Authorization (this phase) answers *"is this valid principal allowed to do THIS specific thing?"* — `ResourceAuthorizationGuard`, a **second, separate** guard. NestJS applies guards in the array order given to `@UseGuards(...)`; every route in this phase lists `ExternalBearerAuthGuard` first, `ResourceAuthorizationGuard` second — the second guard's very first check is that a principal already exists (attached by the first), and it fails closed (401, treated as an authentication failure, not an authorization one) if that invariant is somehow violated.

## 2. The seven layers, never collapsed to one boolean

| Layer | Question | Owned by | Enforced by |
|---|---|---|---|
| 1. Authentication | Is the token valid? | Identity Platform | `ExternalBearerAuthGuard` (Phase 2D.5) |
| 2. Resource Trust | Was this token issued for this audience? | Identity Platform | `ExternalAccessTokenValidator` (Phase 2D.5) |
| 3. Tenant Context | Which tenant does this principal represent? | Identity Platform | `principal.tenantId` (Phase 2D.5), never request input |
| 4. Product Entitlement | Is this tenant entitled to use this product? | Identity Platform (data), Product (whether/when to check) | `ProductAccessService` (Phase 2B.2) — available, NOT automatically invoked (§4 below) |
| 5. OAuth Scope | Does this token permit the requested capability category? | Identity Platform (mechanism), Product (which scopes to require) | `ResourceAuthorizationGuard` + `requireScopes()`/`hasScope()`/`requireAnyScope()` |
| 6. Product IAM | Does this principal have the required product permission? | **Product**, exclusively | `ResourceAuthorizationPolicy` (product-supplied) |
| 7. Resource Policy | Is this particular operation/resource allowed? | **Product**, exclusively | `ResourceAuthorizationPolicy` (product-supplied) |

`AuthorizationDecision` (`{allowed, reasonCode?, requiredScope?, requiredPermission?}`) is the one typed result every layer's outcome is expressed in — `allowed` is checked with `=== true`, never truthy-coerced, so an incomplete/buggy policy implementation returning `{}` is a denial, never an accidental allow.

## 3. Resource Server boundary (recap, Phase 2D.5 unchanged)

`AuthenticatedExternalPrincipal` → `ResourceAuthorizationContext` (`toResourceAuthorizationContext()`) is the ONE typed identity representation; this phase adds no second, parallel representation of the same identity. `ResourceAuthorizationContext` now also exposes `jti` at the top level (alongside the existing `tenantId`/`audience`/`scopes`/`subject`/`clientId`/`serviceAccountId`), matching this phase's own brief's suggested shape.

## 4. Product boundary — what the Identity Platform is, and is not, aware of

The Identity Platform ships:

- The **contract** (`ResourceAuthorizationPolicy`, `ResourceAuthorizationRequest`, `AuthorizationDecision` — `src/modules/resource-server/authorization/interfaces/`).
- The **registry** a product's own bootstrap code registers its policy implementation into, keyed by an opaque `productId` string (`ResourceAuthorizationPolicyRegistry`).
- The **guard** that enforces Layer 5 generically and delegates Layers 6-7 to whatever policy is registered (`ResourceAuthorizationGuard`).
- The **decorator** a route uses to declare its requirement (`@RequireResourceAuthorization({productId, resource, action, requiredScopes?, requiredPermissions?})`).

The Identity Platform ships **zero** implementations of `ResourceAuthorizationPolicy` for any real product. `productId`/`resource`/`action`/`requiredPermissions` are opaque strings this module never interprets — no `BOOKING_CREATE`, `PATIENT_VIEW`, `CUSTOMER_VIEW`, or any other product-specific permission/resource/action name exists anywhere in this codebase's own shipped code. The only implementations that exist in this repository are inside `tests/phase2d6-resource-authorization.e2e-spec.ts` itself — test-authored, using entirely made-up `resource-server-demo-product-a`/`-b` identifiers — proving the contract works without teaching the Identity Platform anything about a real product's domain.

## 5. Tenant boundary

`ResourceAuthorizationContext.tenantId` comes exclusively from the cryptographically verified token (Phase 2D.5) — never from `request.body.tenantId`, never from a header, never from any other request-supplied value. `assertRequestedTenantMatches()` (Phase 2D.5, reused unchanged) remains the reference contract for a route that also accepts an explicit tenant parameter: the supplied value must equal `principal.tenantId` exactly, or the request is denied (`ForbiddenException`, 403) — never silently substituted, and the mismatch is treated as **product-layer** authorization, not an RFC 6750 Bearer-token failure, since the token itself is perfectly valid.

## 6. Product entitlement (`TenantProductEntitlement`) — a distinct, NOT automatically-invoked layer

`ProductAccessService.canAccess(tenantId, productId)` (Phase 2B.2) is the existing, unchanged, single source of truth for "is this tenant entitled to use this product." `ResourceAuthorizationGuard` itself **never calls it** — per this phase's own brief (§10), an automatic database lookup on every resource request would reintroduce exactly the per-request live-dependency Phase 2D.5's local-first token validation was designed to avoid. Instead, entitlement checking is **available for a product's own policy to compose**, exactly as `tests/phase2d6-resource-authorization.e2e-spec.ts`'s own demo policy does (calling `ProductAccessService.canAccess()` from inside its `authorize()` implementation). A product that doesn't need a live entitlement check (e.g. one satisfied by the fact that Phase 2D.4 issuance already required an ACTIVE entitlement for the audience's own tied Product) may simply not call it.

**Important, empirically-confirmed nuance**: Phase 2D.4's own `POST /oauth/token` issuance flow *already* requires `ProductAccessService.canAccess(tenantId, application.productId)` to pass before a token is issued at all (`docs/PHASE_2D4.md`, its own step 6) — for the ONE Product tied to the calling Application via its own audience. This means, for that specific Product, a successfully-issued token already proves entitlement was ACTIVE **at issuance time**. A resource server's own Layer-4 check therefore adds value in exactly two cases: (a) checking entitlement for a genuinely *different* Product than the one implicitly tied to the calling Application (the demo policy's own `productId2`, deliberately distinct from the issuance-tied `productId`, demonstrates this), or (b) wanting a **live**, request-time re-check rather than trusting the issuance-time snapshot for the token's full remaining TTL (see §8 below). Both are the product's own choice, never forced by the generic pipeline.

## 7. `ServiceAccountTenantGrant` vs. `TenantProductEntitlement` — never merged

```text
ServiceAccount → ServiceAccountTenantGrant → Tenant → TenantProductEntitlement → Product
```

`ServiceAccountTenantGrant` answers *"can this ServiceAccount operate for this Tenant at all"* — checked ONLY at token issuance (Phase 2D.4, `ServiceAccountTenantGrantsService.isGrantActive()`), never re-checked live by anything in this phase. `TenantProductEntitlement` answers a structurally different question — *"can this Tenant use this Product"* — and, per §6 above, MAY be re-checked live by a product's own policy. Neither substitutes for the other; this phase introduces no code that conflates them.

## 8. Revocation / TTL behavior at the authorization layer (explicit, tested)

An already-issued, unexpired token remains valid at the AUTHENTICATION layer (Phase 2D.5, unchanged) even after its underlying `ServiceAccountTenantGrant` is later revoked — this phase's own e2e suite demonstrates the same is true, by construction, at the AUTHORIZATION layer: revoking a grant after issuance does not retroactively deny an already-issued token's resource-authorization request, because nothing in this pipeline re-checks the grant live. This is the SAME deliberate, local-first, TTL-bounded trade-off `docs/RESOURCE_SERVER_ARCHITECTURE.md` §11 already documents for authentication — restated here because it is easy to assume authorization "sees" a revocation the moment it happens, and this phase confirms, with a passing test, that it does not, unless a product's own policy chooses to make a live check.

## 9. OAuth scope vs. IAM permission — reaffirmed, extended

Layer 5 (scope) is enforced directly by `ResourceAuthorizationGuard`, using the exact-match-only helpers in `src/modules/resource-server/utils/require-scope.util.ts`:

- `hasScope(context, scope)` — exact string equality only. `'documents.read'` does NOT satisfy a requirement for `'documents.read.anything'` or match against `'documents.readwrite'`; matching is case-sensitive; a duplicate scope entry changes nothing; an empty/absent scope list satisfies nothing.
- `requireScope(context, scope)` — throws unless present (Phase 2D.5, unchanged signature).
- `requireScopes(context, scopes[])` — **explicit AND**: every listed scope must be present. An empty requirement list is trivially satisfied.
- `requireAnyScope(context, scopes[])` — **explicit OR**, a deliberately separate function (never inferred from context) so AND/OR semantics are never ambiguous at a call site. An empty "any of" list can never be satisfied.

Layer 6 (IAM permission) is **never** derived from Layer 5's scopes by anything in this codebase — `documents.read` (a scope) is never automatically interpreted as `DOCUMENT_VIEW` (a permission). `ResourceAuthorizationRequest.requiredPermissions` is passed through to the product's own policy unevaluated; the Identity Platform assigns it no meaning.

## 10. Product IAM & resource ownership — entirely product-owned

`ResourceAuthorizationPolicy.authorize(context, request)` is the one seam. A policy MAY: check product entitlement (§6), evaluate its own permission model against `context.tenantId`/`context.serviceAccountId`/`request.requiredPermissions`, and decide whether the specific `request.resource`/`request.action` pair is meaningful and permitted at all (an unrecognized resource or action is the POLICY's own decision to deny, with its own `reasonCode` — e.g. `'unknown_resource'`/`'unknown_action'` — never a generic mechanism this platform provides). Resource OWNERSHIP (e.g. "Tenant A has product access, but does not own every resource belonging to Tenant A") is likewise entirely the policy's own responsibility — nothing in `ResourceAuthorizationContext` or the guard implies "every resource is accessible" merely because a token is valid or a tenant is entitled.

## 11. Authorization provider contract — isolation and failure semantics

`ResourceAuthorizationPolicyRegistry` is a plain `Map<productId, ResourceAuthorizationPolicy>` — no global mutable "current product" variable. `.get(productId)` returns exactly the policy registered under that key or `undefined`; there is no fallback, wildcard, or "closest match." Re-registering under an already-used key replaces the previous entry (last write wins, mirroring `JwksClientService.configureJwksUri()`'s own test/bootstrap-override convention). Proven directly: a policy registered for `resource-server-demo-product-a` is never invoked for a request naming `resource-server-demo-product-b`, and vice versa, even when both are registered simultaneously (`tests/phase2d6-resource-authorization.e2e-spec.ts`, "provider isolation").

Failure semantics, all fail-closed, all tested:

| Condition | Result |
|---|---|
| No principal attached | 401 (an authentication failure, not authorization) |
| Route has no `@RequireResourceAuthorization` metadata | 500 (server misconfiguration, not caller-triggerable) |
| Required scope(s) missing | 403 `insufficient_scope` |
| No policy registered for `productId` | 403 `forbidden` |
| Registered policy throws | 403 `forbidden` — the thrown error's own message is never included in the response |
| Policy returns anything other than `{allowed: true}` exactly | 403 `forbidden` |

## 12. 401 vs. 403

401 (`invalid_token`) is reserved for authentication failures — no principal, or (structurally, should it ever occur) this guard invoked without the first. 403 is used for every authorization-layer denial: `insufficient_scope` (Layer 5, carries the standard RFC 6750 `scope="insufficient"` challenge parameter) and `forbidden` (Layers 6-7, a plain `Bearer error="forbidden"` challenge, no scope parameter — there is no missing-scope value to name for a product-IAM/policy denial).

## 13. Audience isolation (Phase 2D.5, unchanged, reaffirmed)

Layer 2 remains exactly Phase 2D.5's `ExternalAccessTokenValidator` — a token issued for one audience is never accepted for another, still no wildcard, still no multi-audience token. This phase adds no new audience-related mechanism; the demo/test routes here reuse the same `@ExpectedAudience` decorator.

## 14. Human vs. service principals

`AuthenticatedExternalPrincipal.type` remains a union of exactly one member today (`'SERVICE_ACCOUNT'`, Phase 2D.5). Nothing in this phase's API surface is named or shaped to assume service-only callers — `ResourceAuthorizationContext`, `ResourceAuthorizationRequest`, and `AuthorizationDecision` carry no `serviceAccountOnly`-flavored method or field; a future human/OIDC-issued principal (`type: 'USER'`) would flow through the identical `ResourceAuthorizationGuard`/`ResourceAuthorizationPolicy` pipeline unchanged. OIDC itself is not implemented in this phase.

## 15. Platform Operator boundary — reaffirmed, tested

A Platform Operator's own bearer token (legacy, HS256, `docs/PLATFORM_OPERATOR_ARCHITECTURE.md`) is rejected outright (401) by `ExternalBearerAuthGuard` itself — it is structurally a different, incompatible token type (HS256 vs. this boundary's mandatory RS256), so it never even reaches `ResourceAuthorizationGuard`, let alone any registered policy. Platform Operator authority remains what ADR-010 already established: an Identity Platform administrative boundary, never an implicit product superuser grant — proven directly (`tests/phase2d6-resource-authorization.e2e-spec.ts`, "Platform Operator token cannot bypass product authorization").

## 16. Confused deputy / token forwarding — reaffirmed, unchanged

ADR-021's prohibition is untouched by this phase. `ResourceAuthorizationGuard` authenticates/authorizes only the caller of the CURRENT request via its own already-validated principal; nothing in this module accepts an already-validated principal as proof that a *different* downstream call is authorized, and no `on_behalf_of`/subject-override parameter exists anywhere in `ResourceAuthorizationRequest` or `AuthorizationDecision`.

## 17. Future product integration (illustrative — no implementation here)

```text
Future TravelOS (a genuinely separate codebase/process)

Identity Platform
      ↓  (RS256 access token, aud = travelos-api)
AuthenticatedExternalPrincipal   ← TravelOS's OWN copy of the Phase 2D.5 validation pattern
      ↓
TravelOS Resource Server         ← TravelOS's own ExternalBearerAuthGuard-equivalent
      ↓
TravelOS Product Authorization   ← TravelOS registers ITS OWN ResourceAuthorizationPolicy
      ↓
TravelOS IAM                     ← BOOKING_CREATE, CUSTOMER_VIEW, etc. — never defined here
      ↓
TravelOS Resource
```

This is documentation only. No TravelOS file, dependency, configuration, or database was read, modified, or referenced by any code in this phase.

## 18. TravelOS remains unmodified

Every line of code in this phase lives inside `E:\wrkspc\identity-platform`. TravelOS is referenced above only as the same illustrative "a future real Resource Server" example every prior Phase 2D document already uses.

## 19. What this phase does NOT do (the central acceptance criterion)

No central permission registry. No `BOOKING_VIEW`/`PATIENT_VIEW`/`MEMBER_CREATE`-style code anywhere in this codebase. No mandatory per-request database lookup added to the generic authentication/authorization pipeline. No product-specific role, resource, or action name is defined by Identity Platform. `ResourceAuthorizationPolicy` is the seam; the product remains, entirely, on the other side of it.

## 20. Deferred (unchanged from every prior Phase 2D document)

Authorization Code, PKCE, OIDC, `/userinfo`, MFA, Passkeys, SAML, Dynamic Client Registration, Device Authorization, Token Exchange, Impersonation, token forwarding, introspection as a normal request path, SDKs, TravelOS integration, and any product-specific IAM implementation.

## 21. Implementation status (Phase 2D.10, `docs/PHASE_2D10.md`, `docs/PRODUCT_INTEGRATION_CONTRACT.md`)

This document's own seven-layer pipeline is now formally named "the product integration contract" and restated, unchanged, in `docs/PRODUCT_INTEGRATION_CONTRACT.md` §2. Two new, stable, product-facing type aliases (`IdentityAuthorizationContext`/`IdentityAuthorizationPolicy`/`IdentityAuthorizationRequest`/`IdentityAuthorizationResult`, `src/contracts/identity-authorization.contract.ts`) alias `ResourceAuthorizationContext`/`ResourceAuthorizationPolicy`/`ResourceAuthorizationRequest`/`AuthorizationDecision` — no rename, no behavior change. `tests/phase2d10-product-integration-contract.e2e-spec.ts` proves a policy authored using ONLY those aliased names still runs, unmodified, through `ResourceAuthorizationGuard`, and additionally exercises two entitlement states this document's own Phase 2D.6 test did not (entitlement `REVOKED`, product `DISABLED`).
