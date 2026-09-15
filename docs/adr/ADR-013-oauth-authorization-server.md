# ADR-013: Identity Platform as OAuth 2.1 Authorization Server

## Context

ADR-007 already decided a phased path (A: proprietary REST auth → B: OAuth2 → C: OIDC), gated on "a genuine third-party/delegated-access requirement" before B's authorization_code grant is actually **built**. Phase 2D is an architecture-only exercise — no implementation — so this ADR formalizes exactly what "B" means architecturally, ahead of that trigger, so the design is ready rather than improvised when the trigger fires. See `docs/PHASE_2D_ARCHITECTURE.md` for the full narrative.

## Problem

If/when the Identity Platform issues delegated, product-scoped access on behalf of a human or a service, it must do so via a standard, well-audited protocol rather than continuing to extend the proprietary login/refresh API indefinitely — the proprietary API has no concept of a third-party client, consent, or scoped delegation, and retrofitting those concepts onto it would eventually reproduce OAuth badly instead of adopting it well.

## Options

1. **Keep extending the proprietary REST auth API** with ad hoc concepts (per-application scopes, a bespoke "delegate to this app" flow). Rejected — reinvents OAuth without its interoperability, its audited threat model, or its ecosystem of relying-party libraries (same reasoning ADR-006 already applied to service auth).
2. **Adopt OAuth 2.1** (the consolidated, security-hardened successor profile of OAuth 2.0 — mandatory PKCE, no implicit grant, no resource-owner-password-credentials grant, exact redirect-URI matching) as the Identity Platform's authorization-server role, additive to the existing proprietary API rather than replacing it.
3. **Delegate authorization-server duties to an external IdP** (Keycloak/ZITADEL/Ory/Auth0) fronting this platform. Already decided against in ADR-008; not re-opened here.

## Decision

**Option 2.** The Identity Platform becomes an OAuth 2.1 Authorization Server, additive to its existing proprietary bearer-token API (`docs/AUTHENTICATION_ARCHITECTURE.md`), which remains the mechanism for the Identity Platform's **own** first-party web/admin surfaces and is not being replaced. OAuth 2.1 (not bare OAuth 2.0) specifically: PKCE is mandatory for every authorization_code exchange regardless of client type (`docs/OAUTH_ARCHITECTURE.md` §3), the implicit and resource-owner-password-credentials grants are excluded from the design entirely, and redirect URIs require exact string matching (no wildcard/prefix matching) — see `docs/PHASE_2D_THREAT_MODEL.md`.

## Rationale

OAuth 2.1's specific hardening choices (mandatory PKCE, no implicit grant) close exactly the historical OAuth 2.0 vulnerability classes (`docs/PHASE_2D_THREAT_MODEL.md` — authorization code interception, token leakage via fragment) that a from-scratch design would otherwise have to rediscover. Keeping the proprietary API alongside OAuth (rather than migrating it) avoids an unforced, high-risk breaking change to every existing tenant-facing client for a capability (third-party delegation) they don't need — the proprietary API and the OAuth surface serve genuinely different callers (first-party session-based UIs vs. third-party/delegated/service consumers) and can coexist indefinitely, exactly as ADR-007 anticipated ("moving from A → B → C is additive").

## Security implications

Authorization-server responsibilities (client registration integrity, redirect-URI validation, PKCE verification, authorization-code single-use enforcement, consent where applicable) become new, security-critical surface the moment they are built — each is threat-modeled individually in `docs/PHASE_2D_THREAT_MODEL.md` before any implementation phase begins.

## Operational implications

No new deployed service — this role is implemented inside the existing NestJS application, using the existing `Application`/`Product` tables (ADR-009) and the existing `security_user`/`Membership`/`Organization`/`Tenant` domain model unchanged. No new infrastructure dependency is introduced by this decision alone.

## Consequences

Every future OAuth/OIDC endpoint (`/authorize`, `/token`, `/userinfo`, `/.well-known/*`) is additive API surface, versioned and documented before being built (`docs/EXTERNAL_API_TRUST_BOUNDARY.md` §API surface). The existing `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/context/*` endpoints are unaffected and remain the primary authentication path for the Identity Platform's own first-party experiences.

## Deferred considerations

Actual endpoint implementation remains gated on ADR-007's own trigger ("a genuine third-party/delegated-access requirement") — this ADR authorizes the *design*, not the build. See `docs/PHASE_2D_ARCHITECTURE.md` §Implementation Roadmap for the sequencing once triggered.
