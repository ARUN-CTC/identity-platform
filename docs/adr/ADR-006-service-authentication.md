# ADR-006: Service-to-Service Authentication

## Context

Product backends (e.g. TravelOS's own backend, calling the Identity Platform without an end-user present — batch jobs, webhooks, admin tooling) need to authenticate as themselves. Full analysis: `docs/SECURITY_ARCHITECTURE.md` §5.

## Problem

Choose a mechanism that works across products built in different languages/stacks, without requiring shared infrastructure (certificate authorities, service mesh) that may not exist in every product's deployment environment on day one.

## Options

1. OAuth2 Client Credentials grant (`ServiceAccount` tied to a registered `Application`).
2. Bespoke, non-standard service-account tokens.
3. mTLS.
4. Long-lived static API keys sent on every request.

## Decision

**Option 1** now; JWT client-assertion (RFC 7523) recommended as an upgrade path for higher-sensitivity products; mTLS deferred as a future, deliberately-adopted layer underneath OAuth for products with a genuine zero-trust-network requirement; Option 4 (static API keys) rejected outright.

## Rationale

Option 2 reinvents a standard for no benefit — every mainstream HTTP client and backend framework already knows how to do a client-credentials grant, so choosing the standard grant type costs nothing and buys interoperability with any future product's stack, satisfying the platform's own "must not force every product onto one language" principle (`docs/SDK_STRATEGY.md`). Option 3 (mTLS) is the strongest guarantee but requires certificate lifecycle infrastructure that cannot be assumed present across three independently-deployed products on day one — real operational cost with no immediate corresponding requirement, so it's deferred rather than mandated. Option 4 is rejected because a long-lived credential sent on every request is strictly worse than the short-lived-token pattern already adopted for user authentication (`docs/TOKEN_ARCHITECTURE.md`) — there is no principled reason for service credentials to be held to a lower standard than user credentials.

## Consequences

Every product's backend registers as (or provisions) a `ServiceAccount` under its own `Application` and exchanges `client_id`/`client_secret` for short-lived access tokens (`POST /v1/oauth/token`, `docs/API_BOUNDARY.md` §7) rather than embedding a static key. Higher-sensitivity products (Healthcare is the clear first candidate) are steered toward JWT-client-assertion sooner.

## Risks

Client-secret rotation must actually be exercised (a documented, testable admin operation), or it becomes a long-lived credential in practice despite the mechanism supporting rotation — flagged for the Phase 2 implementation plan (Phase 2E) to include a rotation runbook, not just the capability.
