# ADR-021: Token Exchange, Impersonation, and Token-Forwarding Boundary

## Context

ADR-016 §6 noted in passing that RFC 8693 Token Exchange "is explicitly not adopted... deferred" without a dedicated decision on the closely related, easily-conflated questions of impersonation and token forwarding. The Phase 2D Architecture Gate requires this resolved explicitly, since an implementer left to infer a delegation model during coding is exactly the risk this gate exists to close (`docs/PHASE_2D_ARCHITECTURE.md`'s own completion standard: "without making any new security-critical architectural decisions during coding").

## Problem

Once a service (an `Application` acting via client_credentials, ADR-018 as amended) sits between a human's request and a third downstream service (e.g. "TravelOS Backend" receiving a human's access token, then needing to call "Document Intelligence API" to fulfill that request), an implementer must know precisely what is and is not permitted: may the human's token simply be forwarded? May TravelOS Backend "become" the human for that downstream call? Left undecided, either question tends to get answered ad hoc, in code, by whichever engineer hits it first — precisely the outcome this ADR prevents.

## Options

**Token Exchange (RFC 8693)**
1. Adopt now — lets a service formally exchange one token for another (e.g. a human-scoped token for a narrower, downstream-audienced one), the standards-based answer to "on-behalf-of" delegation.
2. Defer until a named requirement appears.

**Impersonation** (a mechanism letting one principal act with another principal's full identity/authority)
1. Introduce a bounded, audited impersonation capability (e.g. for support tooling).
2. Prohibit entirely — no mechanism, anywhere in this architecture, lets one principal assume another's identity.

**Token forwarding** (a service passes a human's own access token, unmodified, to a downstream service as if that downstream service were the original caller)
1. Permit it as a convenience.
2. Prohibit it — every service-to-service call uses the calling service's own credential (client_credentials), never a forwarded human token.

## Decision

**Token Exchange: deferred** (reaffirming ADR-016 §6) — no `/token` `grant_type=token_exchange` support is designed or built until a genuine, named on-behalf-of delegation requirement appears; this ADR fixes the *boundary* around that gap (below), not the mechanism that would eventually fill it.

**Impersonation: prohibited, unconditionally.** No mechanism anywhere in this architecture — not Platform Operator administration (ADR-010, unchanged), not service authentication (ADR-015/018), not a future Token Exchange implementation — ever lets one principal (human or Application) act *as* another principal's own identity. A Platform Operator may grant or revoke an Application's *rights* (scopes, tenant grants); it may never assume an Application's or a human's own `sub`. This is the same boundary `docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md` §7 already states for Platform Operators, generalized here to bind every principal, permanently, not as a per-feature callout.

**Token forwarding: prohibited as a supported pattern.** A service must never simply pass a human's own bearer access token on to a downstream service and let that downstream service treat the forwarded token as though the original human were calling it directly. Instead:

```text
Human's request → TravelOS Backend (Application A)
                          │
                          │  needs to call Document Intelligence API (Application C)
                          │  to fulfill this request
                          ▼
                   Application A authenticates to C using ITS OWN
                   client_credentials (its own Application identity,
                   its own scopes, its own ApplicationTenantGrant —
                   ADR-015 as amended)
                          │
                   The original human's identity, if C's own business
                   logic needs to know it, is passed as ORDINARY
                   REQUEST DATA (e.g. a `subject` or `on_behalf_of`
                   field in the request body/headers) — NEVER as a
                   bearer credential substitution, and NEVER treated
                   by C as proof of authorization on its own (C still
                   independently authorizes Application A's own right
                   to make this call, exactly as any other
                   service-to-service call would be authorized)
```

## Rationale

Prohibiting impersonation outright (rather than building a "bounded, audited" version) is the smaller, safer architecture: every audited-impersonation design still requires answering every one of Token Exchange's hard questions (audience narrowing, consent, revocation propagation) to do safely, and this platform has no named requirement forcing that cost today — building it "for flexibility" is exactly the unrequested complexity the Phase 2D brief instructs against. Prohibiting bare token forwarding closes the **confused deputy** threat class directly: a downstream service that accepts a forwarded token cannot distinguish "the original human is genuinely, currently, making this exact request" from "some intermediate service decided to relay a token it captured earlier for an unrelated purpose" — mandating that every hop authenticates with its *own* credential, and passes the human's identity only as inert data never trusted as a credential, means every hop's authorization decision is made about the actual, current caller, never inferred from a forwarded artifact. This is also why `aud` (ADR-016, ADR-020) already structurally blocks naive forwarding even if attempted: a token audienced for TravelOS Backend is rejected outright by Document Intelligence API's own mandatory audience check, forcing the correct pattern (a fresh, C-audienced service token) by construction, not merely by policy.

## Security implications

Every multi-hop, service-initiated call is independently authorized at every hop (ADR-020's pipeline, applied to the calling service's own token, at every hop) — there is no privilege inherited across hops merely because an earlier hop was authorized. This is the direct architectural closure of the "confused deputy" and "token forwarding" entries added to `docs/PHASE_2D_THREAT_MODEL.md` by this gate review.

## Operational implications

A service that needs to act "on behalf of" a human for a downstream call (rather than merely informing the downstream service who the original human was) has no supported mechanism today — this is a real, accepted capability gap, not an oversight, and is exactly what a future, named-requirement-triggered Token Exchange implementation would close.

## Consequences

Every future service integration must be designed with its own service-to-service credential for every hop it makes, never a forwarded human token — stated here as a hard requirement for any product's own backend architecture built against this platform, the same way `aud` validation already is.

## Deferred considerations

If a genuine on-behalf-of delegation requirement appears (e.g. a support tool that must act within a user's own permission boundary, narrower than full impersonation), RFC 8693 Token Exchange — not a bespoke impersonation mechanism — is the designated future extension point, evaluated at that time against this ADR's own "prohibited unless" framing.
