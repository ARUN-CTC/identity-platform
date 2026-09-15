# ADR-019: Organization Context Integration with OAuth/OIDC Flows

## Context

ADR-016 decided *what claims* carry tenant/organization context. This ADR decides *how a client requests, and the platform validates, organization context specifically within the OAuth authorization_code+PKCE flow* — a genuinely new integration point, since Phase 2C's `POST /v1/auth/context/switch` was designed entirely around the existing proprietary bearer-token session, with no OAuth `/authorize`/`/token` request in the picture at all.

## Problem

OAuth's `/authorize` request has no standard parameter for "which organization." Define where organization selection happens in an authorization_code flow, how it's validated, and how it behaves across `/token` and `/refresh` — without letting the client's request parameter become authorization by itself, and without duplicating Phase 2C's validation logic in a second, parallel code path that could drift from it.

## Options

1. **A non-standard `organization_id` query parameter on `/authorize`**, trusted as-is. Rejected outright — this is precisely "client establishes tenant authorization," the principle this entire platform's Phase 2C work exists to prevent.
2. **No organization selection at `/authorize` at all; context is always selected after the fact**, via the existing `POST /v1/auth/context/switch`, using the OAuth-issued access token exactly as a proprietary-flow token already does. Simplest, fully reuses Phase 2C's existing, hardened validation — an OAuth client that needs a specific organization performs one extra round-trip after token issuance.
3. **An `organization_id` *hint* parameter at `/authorize`**, used only to pre-select which organization a human sees on an (optional, first-party-skippable) organization-picker screen during authentication — never trusted as the final grant. The actual grant still runs through the exact same Membership/Organization/Tenant validation `switchOrganizationContext()` already performs, server-side, before any token naming that organization is issued.

## Decision

**Option 3, layered on Option 2.** `/authorize` accepts an optional `organization_id` **hint** — used purely to pre-populate a picker UI (or silently proceed, for a first-party client where no picker is shown) — and the actual authorization decision re-runs the identical validation chain `AuthenticationService.switchOrganizationContext()` already implements (Membership → Organization → Tenant, live, never assumed). The resulting authorization code, and the access token exchanged for it, carry the *validated* result, never the raw hint. A client is always free to skip the hint entirely and call `POST /v1/auth/context/switch` afterward instead (Option 2) — both paths converge on the same validation function; this ADR does not introduce a second implementation of it.

## Rationale

This is a direct, minimal-surface-area extension of the "client selects an organization, server derives and validates everything else" principle Phase 2C already hardened and independently security-reviewed — reusing that exact validation function (not a parallel reimplementation for the OAuth code path) is what prevents this integration point from becoming a second place the same invariant could be violated by a future edit to only one of the two paths. A bare hint parameter (rather than a trusted parameter) keeps the OAuth flow's UX benefit (skip a redundant post-login picker round-trip for a first-party client that already knows which organization it wants) without ever treating client input as authorization.

## Security implications

An invalid/forged/unauthorized `organization_id` hint fails exactly the way `switchOrganizationContext()`'s denial path already fails today (identical error shape, `docs/ORGANIZATION_CONTEXT_SECURITY.md` §3's enumeration-resistance guarantee) — it must never distinguish "you don't belong there" from "that organization doesn't exist" at the OAuth layer either.

## Operational implications

No new validation logic is introduced — the OAuth `/authorize` handler (when built) calls into the same service method the proprietary `context/switch` endpoint already calls. This is a design constraint on the future implementation, not merely a suggestion: a second, independent validation implementation for the OAuth path is an explicit anti-pattern this ADR forbids.

## Consequences

**Staleness/revocation behavior is identical to Phase 2C's existing, tested model** (`docs/ORGANIZATION_CONTEXT_SECURITY.md` §2): a Membership revoked, or an Organization/Tenant disabled, after an OAuth-issued access token was minted is caught on that token's next `/token` refresh-grant use, exactly as it is today for the proprietary refresh flow — the organization context clears back to none rather than hard-failing the refresh, and the event is audited (`organization_context.cleared_stale`, unchanged). A product entitlement revoked after issuance is a **product API's own concern at request time** (`docs/APPLICATION_AUTHORIZATION.md` §Product entitlement interaction) — the Identity Platform's token layer does not re-validate entitlement on every resource-server request; the resource server (or a short-TTL cache of `docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md`'s decision) is where that check belongs, consistent with ADR-011.

## Deferred considerations

A first-party organization-picker UI/UX (whether to show one at all, vs. silently using the caller's last-selected organization) is a product-UX decision outside this platform's own scope — this ADR fixes only the server-side contract (hint accepted, never trusted, real validation always runs), not any particular client experience.
