# ADR-003: Token Strategy

## Context

Phase 1's JWT access token has no `aud` claim (no second consumer ever existed) and no documented claim contract. Full analysis in `docs/TOKEN_ARCHITECTURE.md`.

## Problem

Multiple products must each be able to trust a token independently, offline where possible, without the token becoming a large, staleness-prone bag of authorization data, and without a shared symmetric secret spreading a single point of compromise across every product.

## Options

1. **Symmetric signing (HS256), shared secret with every product.**
2. **Asymmetric signing (RS256/EdDSA), public verification via JWKS.**
3. **Full permission expansion in every token.**
4. **Roles + scopes in the token; fine-grained permission checks server-side/on-demand.**

## Decision

Asymmetric signing (2) with a mandatory `aud` claim per registered `Application`; authorization claims limited to roles + scopes (4), not full permission expansion (rejecting 3); no ID token introduced until real OIDC adoption (`ADR-007`).

## Rationale

A shared symmetric secret (1) handed to every product is a credential every product must protect equally well, and a compromise anywhere becomes a forgeable-token-anywhere problem — unacceptable the moment a second, independently-operated product exists. Full permission expansion (3) was rejected specifically because of size and staleness: permissions change far more often than role assignments, and baking them into a token creates a window where a revoked permission remains exploitable until the token naturally expires. Roles+scopes (4) keeps the token small and bounds the staleness window to role assignment changes (rarer) while pushing the fast-changing, fine-grained decision to a real-time check (`/v1/authorize`) or a short-TTL cache. Full trade-off analysis: `docs/TOKEN_ARCHITECTURE.md` §6.

## Consequences

Every product must validate `aud`, not just signature/expiry — a hard requirement stated explicitly because it is easy to silently skip. Products that want fast, fine-grained permission checks without a network round-trip per request must build a short-TTL local cache (`docs/TOKEN_ARCHITECTURE.md` §6) — a real implementation cost placed on products, justified by the availability and staleness trade-offs in `docs/AVAILABILITY_MODEL.md`.

## Risks

Key management (rotation, JWKS caching correctness) becomes genuinely load-bearing infrastructure the moment more than one product depends on it — mitigated by the overlap-window rotation policy in `docs/SECURITY_ARCHITECTURE.md` §2, but this is now a shared dependency across every product and must be operated with the appropriate care.
