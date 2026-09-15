# ADR-008: Open-Source IAM Engine Strategy

## Context

Phase 1 built the current IAM mechanism in-house (extracted from TravelOS, then generalized in Phase 2's documents). The brief asks whether Phase 2 should instead adopt an established open-source IAM engine (Keycloak, ZITADEL, Authentik, Ory) behind the platform's own API boundary, rather than continuing to build internally.

## Problem

Established IAM engines offer more protocol surface (SAML, LDAP, SCIM, MFA, passkeys, federation) out of the box than this platform has built. But adopting one is not free — it means taking on that engine's own data model, deployment footprint, and extension model as a permanent dependency, and reshaping this platform's already-designed domain model (`docs/IDENTITY_DOMAIN_MODEL.md`) to fit someone else's.

## Options evaluated

| | Keycloak | ZITADEL | Authentik | Ory (Kratos+Hydra+Keto) |
|---|---|---|---|---|
| Architecture | Java/Quarkus, monolithic admin+runtime | Go, API-first, cloud-native | Python/Django, admin-UI-first | Go, unbundled microservices (identity/OAuth/authz split into separate services) |
| OIDC/OAuth2 | Full | Full | Full | Full (via Hydra) |
| SAML | Full (IdP and SP) | Partial/enterprise-tier | Full | Not built-in |
| MFA/Passkeys | Full | Full | Full | Kratos supports both |
| Organizations/multi-tenancy | Realm-based (heavyweight per-tenant unit, not designed for thousands of lightweight tenants) | Native "Organizations" concept, closer to this platform's model | Native multi-tenancy via "Brands" | Kratos is tenant-agnostic by design; multi-tenancy is the integrator's job |
| RBAC | Full, coarse-grained | Full | Full | Keto is a dedicated fine-grained (Zanzibar-style) authorization service — more powerful, more integration work |
| APIs/SDKs | REST admin API + many community SDKs | REST/gRPC + growing SDK set | REST API | REST APIs per service, well-documented |
| Deployment | Heaviest (JVM, needs tuning, historically slower cold starts) | Lightest of the "full IAM suite" options | Moderate (Python stack, Redis+Postgres) | Lightest per-service, but now 2-3 services to operate together |
| Database model | Its own, extensive, not meant to be extended with foreign business tables | Its own, somewhat more API-friendly | Its own | Its own, deliberately minimal (Kratos doesn't store arbitrary product data by design, closest philosophical match to this platform's "don't own product data" principle) |
| Licensing | Apache 2.0 | Apache 2.0 (core) | MIT | Apache 2.0 |
| Operational complexity | High (JVM tuning, realm sprawl at scale) | Moderate | Moderate | Moderate-high (multiple services to run and keep consistent) |
| Vendor lock-in | Low license risk, high *model* lock-in (realm/client model is pervasive) | Low | Low | Low — explicitly designed to be embedded behind your own domain model |
| Migration difficulty (in, and later out) | High | Moderate | Moderate | Lower (thin services, less of "your" data lives inside them) |

## Decision

**Continue building internally (Option A), keep the existing in-house mechanism, but preserve the ability to swap the engine later by keeping absolutely everything product-facing behind the REST API boundary (ADR-001) — never expose an engine-specific admin API, client library, or data model to any product directly.**

If a future, concrete requirement exceeds what is reasonable to build in-house (most likely candidate: full SAML federation for a specific enterprise customer, or a hard compliance requirement for FIDO2/passkey attestation depth), re-evaluate with this priority: **ZITADEL first** (closest conceptual match — it already has a native "Organization" concept resembling this platform's own, is API-first, and is the lightest of the full-suite options to operate), **Ory second** (best fit if the need is narrowly "just OIDC + fine-grained authz" rather than the full enterprise-federation suite, precisely because Kratos's philosophy of not owning product data already matches `docs/DATA_OWNERSHIP.md`), **Keycloak third** (safest "checks every enterprise-procurement box" fallback if a customer's requirement is inflexible about SAML/LDAP specifically, accepted at the cost of its heavier realm model and JVM operations profile), **Authentik** as a lower-ops alternative to Keycloak if the SAML/LDAP requirement is real but the customer's scale doesn't justify Keycloak's operational weight.

## Rationale

Phase 1 already produced a clean, product-agnostic core (`docs/IDENTITY_SOURCE_INVENTORY.md`: 24 reusable components, LOW TravelOS coupling) — throwing that away to adopt an external engine now would be replacing a working, understood system with a larger, less-understood one to gain protocol surface (SAML, LDAP, SCIM) that no product currently needs (see ADR-007 — none of these are committed to on the current roadmap either). Every evaluated engine also has its own tenant/realm/organization model that does not map cleanly onto this platform's own (ADR-002) — adopting one now would mean designing *two* domain models (the engine's, and this platform's translation of it) instead of one, for a benefit (protocol breadth) that isn't yet a real requirement.

## Consequences

The in-house engine must keep pace with genuinely-needed protocol additions incrementally (MFA, then OIDC, then possibly SAML — ADR-007's phased path) rather than getting them "for free" from a suite. This is accepted as the right trade against the alternative of a large, premature migration.

## Risks

If an enterprise deal is blocked on SAML/SCIM sooner than expected, the in-house path may not catch up fast enough — mitigated by this ADR naming ZITADEL/Ory/Keycloak/Authentik evaluations up front (not starting from zero if that day comes) and by the API-boundary discipline (ADR-001) that keeps a future swap possible without a product-facing breaking change, since every product only ever sees this platform's own `/v1` API regardless of what runs behind it.

## Operational impact

None today — no new service is deployed. The impact is entirely deferred risk-management: keep the internal engine's product-facing contract stable and engine-agnostic so that *if* a swap is ever justified, the products consuming this platform notice nothing.

**Final recommendation:** do not adopt an external IAM engine in Phase 2 or its immediate follow-on phases; revisit only when a specific, named enterprise requirement (not a speculative one) exceeds the in-house roadmap in ADR-007.
