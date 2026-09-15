# Target Architecture

This is the synthesis document — every decision recorded in the other Phase 2 documents and ADRs, assembled into one architectural picture. It restates nothing in depth; each section links to the document that owns the actual analysis.

## 1. Logical architecture

```text
Client (Browser / Mobile / Third-party app)
              │
              ▼
          Product (TravelOS / Healthcare / Gym / future)
              │  REST, bearer JWT + refresh (ADR-001, ADR-003)
              ▼
        Identity API  (/v1/..., docs/API_BOUNDARY.md)
              │
              ▼
        Identity Core
   ┌──────────┼──────────┬───────────┬────────────┐
   ▼          ▼          ▼           ▼            ▼
Authentication  Authorization  Organization   Security    Audit
(docs/AUTHENTICATION_    (docs/AUTHORIZATION_   (docs/IDENTITY_   (docs/SECURITY_  (SecurityEvent/
 ARCHITECTURE.md,         ARCHITECTURE.md,       DOMAIN_MODEL.md,  ARCHITECTURE.md) AuditEvent,
 docs/TOKEN_              ADR-004)               docs/ORGANIZATION_                 SECURITY_
 ARCHITECTURE.md)                                 CONTEXT.md, ADR-002)                ARCHITECTURE.md §6)
              │
              ▼
        Identity Database (docs/DATA_OWNERSHIP.md — owned exclusively here)
```

## 2. Integration architecture

```text
TravelOS ───────┐
Healthcare ─────┼──  Identity Platform API  (docs/API_BOUNDARY.md)
Gym ────────────┤
Future Apps ────┘
```

Each product registers as one `Product` + N `Application`s (`docs/PRODUCT_REGISTRATION.md`), each Tenant subscribes per-product via `TenantProductSubscription`, each product owns and registers its own permission namespace (`docs/AUTHORIZATION_ARCHITECTURE.md` §2), and none of the three shares a database, ORM, or domain-code import with the Identity Platform or with each other (`docs/DATA_OWNERSHIP.md`, worked example in `docs/MULTI_PRODUCT_INTEGRATION.md`).

## 3. Security boundary

Asymmetric-signed tokens validated locally per product (`docs/TOKEN_ARCHITECTURE.md` §7); mandatory `aud` check prevents cross-product replay; RLS + application-layer checks enforce tenant/organization isolation (`docs/SECURITY_ARCHITECTURE.md` §3); service-to-service calls use OAuth2 client-credentials (ADR-006); the Identity Platform's own signing key never leaves its process boundary. Full detail: `docs/SECURITY_ARCHITECTURE.md`.

## 4. Data boundary

Identity/auth/authz/organization/audit data lives exclusively in the Identity Platform's own database; every product's business data lives exclusively in that product's own database; the only sanctioned crossing point is the API, and the only thing a product may persist about an Identity is a reference id plus an explicitly-cacheable, platform-driven read replica of specific fields (never an independently-editable copy of anything authorization-relevant). Full detail: `docs/DATA_OWNERSHIP.md`.

## 5. API boundary

Versioned REST (`/v1`), additive-first evolution, per-resource-group version bumps only on genuine breaking changes, OpenAPI as the generation source for future SDKs. Full detail: `docs/API_BOUNDARY.md`, `docs/SDK_STRATEGY.md`.

## 6. Deployment boundary

The Identity Platform is one independently deployable service with its own database, unchanged from Phase 1's isolation model (`docs/PROJECT_ISOLATION.md`) — nothing in Phase 2 introduces a shared deployment, shared container, or shared network namespace between it and any product. Each product deploys entirely independently, coupled to the Identity Platform only through its published API and JWKS endpoint.

## 7. Trust boundary

The Identity Platform is the single trust root for authentication across every product (it is the only holder of credentials and the only signer of tokens). Each product is trusted only for its own business-domain enforcement (product-namespaced permission checks) and never trusted with another product's data, another product's permission meanings, or any other product's tenant's data. Platform-operator staff are a distinct trust tier, deliberately kept outside every tenant's own isolation boundary (`docs/IDENTITY_DOMAIN_MODEL.md` §6) rather than folded into it.

## 8. What this architecture explicitly defers

SAML, full OIDC, LDAP, SCIM, MFA/passkeys, a policy engine, an external IAM engine swap, self-service billing/product-catalog UI — every one of these has a recorded decision (mostly "defer until a named requirement," per ADR-007 and ADR-008), not a silent omission.
