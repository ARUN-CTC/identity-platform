# ADR-014: Identity Platform as OpenID Connect Provider

## Context

ADR-007's phase C ("adopt OIDC specifically when enterprise SSO becomes a real, named customer requirement — not speculatively") has not been triggered by any named customer as of Phase 2D. This ADR designs the OIDC layer ahead of that trigger, as architecture only, so it is additive and ready rather than improvised later — it does not itself trigger adoption.

## Problem

Once the Identity Platform is an OAuth 2.1 Authorization Server (ADR-013), human-facing product applications still need a standard way to obtain **verified identity assertions** (not just an opaque access token) — who the user is, when they authenticated, and with what assurance — expressed in a way any off-the-shelf OIDC relying-party library understands, rather than a bespoke `/v1/auth/me` call every relying party must special-case.

## Options

1. **No ID token — access-token-only**, relying parties call `GET /v1/auth/me`/a future `/userinfo` for identity facts. Workable, but non-standard; no OIDC relying-party library recognizes it, and every future first-party or third-party web app has to hand-roll the "who is this" step.
2. **Full OpenID Connect**: ID token (a second, distinct JWT, separate from the access token), standard `openid profile email` scopes, discovery document, `/userinfo` endpoint.

## Decision

**Option 2**, additive: an ID token is a **new, distinct token type** (per `docs/TOKEN_ARCHITECTURE.md`'s own "reserved" row), never a repurposing of the existing access token and never a replacement for it. It is issued only when the `openid` scope is requested at `/authorize`, alongside — not instead of — the existing access token.

## Rationale

Conflating access token and ID token (as some non-conformant implementations do) breaks the very reason each exists: an access token is meant to be presented to a resource server and re-validated on every call (opaque in meaning to the client), while an ID token is meant to be consumed once by the client itself to learn who authenticated and is never meant to be sent onward to any API. Keeping them structurally distinct (different claim sets, different intended consumer) preserves both the audience-isolation model (`docs/EXTERNAL_API_TRUST_BOUNDARY.md`) and the OIDC specification's own security assumptions — a resource server that mistakenly accepts an ID token as an access token (or vice versa) is a known confusion-attack class (`docs/PHASE_2D_THREAT_MODEL.md`).

## Security implications

`nonce` (replay binding to the original `/authorize` request) and `auth_time`/`amr` (authentication-context assertions) are OIDC-specific claims with no analog in the existing access token — each is scoped and validated exactly as the OIDC Core specification requires, not invented ad hoc. The ID token's audience is always the requesting client's own `client_id` (never a resource-server audience) — it must never be accepted by any resource server as a bearer credential.

## Operational implications

Reuses the same signing infrastructure as the access token (ADR-017) — no separate key material. Discovery document and `/userinfo` (`docs/OIDC_ARCHITECTURE.md`) are additive endpoints, not a replacement for `/v1/auth/me`, which remains the proprietary API's own identity endpoint.

## Consequences

`docs/TOKEN_ARCHITECTURE.md`'s "ID Token: Not yet — reserved" row is superseded by this ADR's design (still not implemented — design only). Standard scopes (`openid`, `profile`, `email`) are introduced as a distinct concept from IAM permissions and from product-namespaced OAuth scopes (`docs/OAUTH_ARCHITECTURE.md` §Scopes) — `openid`/`profile`/`email` govern ID token content, never API authorization.

## Deferred considerations

MFA/`amr` values beyond password-only, and step-up authentication (`acr`), are out of scope until a real requirement (a named compliance or product need) triggers them — the `auth_time`/`amr` claim shape is designed to accommodate this additively, not built now (out of scope per the Phase 2D brief).
