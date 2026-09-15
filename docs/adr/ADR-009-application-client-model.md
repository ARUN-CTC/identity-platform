# ADR-009: Application/Client Model (No Separate Client Entity)

## Context

Phase 2 (`docs/PRODUCT_REGISTRATION.md`) defined `Application` as the registered, credentialed consumer of the Identity Platform's API. Phase 2B's brief asked to validate whether a three-tier `Product → Application → Client` model is actually correct, or whether "Application" and "Client" are the same concept under two names.

## Problem

OAuth2/OIDC terminology universally calls a credentialed API consumer a "client." This platform's own prior documentation calls the same thing an "Application." Phase 2B needed one authoritative answer before writing any schema or endpoint.

## Options

1. **Two entities**: `Application` (a logical grouping — "TravelOS Web") containing one or more `Client`s (the actual `client_id`/`client_secret` holders — allowing multiple credential sets per logical surface, e.g. staging + production).
2. **One entity**: `Application` *is* the client credential holder. "Client" is not a separate table — it's the standard vocabulary for describing `Application`'s credential-related fields (`client_id`, `client_secret`, `client_type`).

## Decision

**Option 2.** One `application` table. No `client` table. "Application" and "client" refer to the same row throughout this platform's documentation and code; where OAuth-standard field names apply (`client_id`, `client_type`), they're used as field names on `Application`, not as a reason to split it into two entities.

## Rationale

The brief's own worked examples for "Application" and for "Client" were identical ("TravelOS Web," "TravelOS Mobile," "TravelOS Backend") — direct evidence that the two questions ("what is an Application" and "what is a Client") were converging on one answer, not two. Option 1 would add a table with no independent behavior of its own (a grouping row referencing N credential rows, where nothing in Phase 2B — or anything currently planned — ever needs more than one live credential per logical surface). This is exactly the class of unnecessary indirection `docs/PRODUCT_REGISTRATION.md` already rejected once, when it declined to model `Product`/`Application`/`Subscription`/`ServiceAccount` as one overloaded entity — the same reasoning cuts the other way here: don't split one entity into two when nothing distinguishes them operationally yet.

## Consequences

Every "client" concept anywhere in this codebase (client_id, client_secret, client_type, and any future `aud` claim) refers to `Application.id`/`Application.clientId`. If a genuine future need for multiple simultaneous credential sets per logical surface appears (e.g., zero-downtime secret rotation needing two live secrets briefly, or a true staging/production split under one conceptual product surface), it can be met by evolving `Application` into the "grouping" role and introducing a new child table at that time — a strictly additive change, not a breaking one, since nothing outside this phase treats `Application.id` as anything but an opaque foreign key today.

## Risks

If OAuth2/OIDC adoption (`docs/adr/ADR-007-oidc-oauth-strategy.md`) later needs a real distinction between "a registered app" and "a specific credential/redirect-URI set for it" (some OIDC providers do split these), this decision may need revisiting at that time — accepted, since building that distinction now, before any OIDC work has started, would be exactly the speculative complexity this ADR argues against.
