# ADR-007: OIDC/OAuth2 Strategy

## Context

The Identity Platform currently exposes a proprietary login/refresh REST API (Phase 1, extended in Phase 2 with `aud`/organization-context). The Phase 2 brief asks whether it should eventually become a standards-based OAuth2 Authorization Server and/or OIDC Provider, and whether SAML/LDAP/SCIM belong on the roadmap at all. Nothing in this ADR is implemented now.

## Problem

Standards adoption (OAuth2/OIDC/SAML/LDAP/SCIM) each solve real problems (third-party app delegation, enterprise SSO, directory sync) but each also brings real complexity. Adopting all of them now, unrequested, would violate the brief's explicit instruction not to build SAML/OIDC/Passkeys/LDAP "unless required by an architectural dependency."

## Options

**A. Application authentication API only** (current Phase 1/2 shape: proprietary login/refresh, bearer JWT).
**B. OAuth2 Authorization Server** (add standard grant types: client_credentials — already decided, ADR-006 — and eventually authorization_code + PKCE for delegated third-party access).
**C. OpenID Connect Provider** (add on top of B: ID tokens, discovery document, standard scopes like `openid profile email`).
**D. Full IAM platform**: B + C + SAML (enterprise SSO as an Identity Provider integration) + LDAP (directory sync/bind) + SCIM (automated provisioning/deprovisioning from an enterprise's own directory).

Comparison:

| | Security | Complexity | Enterprise fit | Maintainability | OSS interoperability | Integration flexibility |
|---|---|---|---|---|---|---|
| A | Fine for first-party products; no delegation model for third parties | Lowest | Poor — enterprise buyers expect SSO | Highest (fully custom, fully understood) | None — nothing else speaks this protocol | Low — only this platform's own clients can integrate |
| B | Adds a well-audited, standard grant model | Moderate | Improves (client_credentials already needed anyway) | Moderate — standard libraries exist | Good — any OAuth2-aware tool/library works | High for machine/service integration |
| C | Adds standard identity assertions (ID token), reduces bespoke "who is this" logic | Moderate-high | Strong — most enterprise SSO tooling expects OIDC specifically | Moderate — OIDC conformance has real edge cases (discovery, nonce/state handling) | Excellent — OIDC is the de facto standard product-to-IdP protocol today | High — any OIDC relying-party library works unmodified |
| D | SAML/LDAP/SCIM each add their own attack surface and legacy-protocol quirks (XML signature handling for SAML especially) | Highest | Needed only for large enterprise/legacy-directory customers | Lowest — four protocol stacks to maintain instead of one | Good (all are standards) but heaviest to implement correctly | Highest ceiling, highest floor cost |

## Decision

**Phased: A (now, already built) → B (client_credentials already decided in ADR-006; add authorization_code+PKCE only when a genuine third-party/delegated-access requirement appears) → C (adopt OIDC specifically when enterprise SSO becomes a real, named customer requirement — not speculatively) → D's individual pieces (SAML, LDAP, SCIM) each decided independently, only when a specific enterprise customer's procurement requirement names them.** No part of D is committed to on a timeline; each is a future, dependency-triggered decision, not a roadmap promise.

## Rationale

This directly follows the brief's own instruction: build these only when an architectural dependency requires them. The `Application`/client model (ADR-005) and asymmetric token signing (ADR-003) are deliberately chosen so that moving from A → B → C is additive (new grant types, new token type, new discovery endpoint) rather than a redesign — the core domain model (Identity, Membership, Role, Permission) is completely orthogonal to which protocol wraps it, which is exactly what makes this phased path safe to defer without painting the platform into a corner. SAML/LDAP/SCIM are kept off the committed roadmap entirely because none of the three initial products (TravelOS, Healthcare, Gym) currently have a named enterprise-SSO or directory-sync requirement — building any of them now would be exactly the "guessing" the brief instructs against.

## Consequences

The current REST login API must keep its claim contract (`docs/TOKEN_ARCHITECTURE.md`) stable enough that adding an ID token later doesn't break existing bearer-token consumers — satisfied by additive-only versioning (`docs/API_BOUNDARY.md` §1). Any future OIDC adoption should reuse the existing `Application` entity as the OAuth "client" registration rather than inventing a parallel concept.

## Risks

Deferring OIDC has a real cost if an enterprise sales conversation stalls on "do you support SSO" before it's built — an accepted, named risk, not an oversight, and one considered smaller than the cost of building unrequested protocol surface now.
