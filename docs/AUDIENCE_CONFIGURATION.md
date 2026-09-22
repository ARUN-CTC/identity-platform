# Audience Configuration

Phase 2UI.2 — investigates the fourth gap Phase 2UI.1 listed: "Application onboarding requires explicit audience configuration." **Finding: this capability was already fully implemented before this phase began.** This document states what already exists, corrects one specific over-claim in Phase 2UI.1's own wizard design, and adds a regression-lock test so this finding can never silently drift.

## 1. What already exists (verified by direct source read, not assumed)

`audiences: string[]` is a real, dedicated column on `Application` (`database/prisma/schema/product.prisma`) — distinct from `allowedScopes`, `grantTypes`, `clientId`, and `productId`, exactly as this phase's own governing instruction required ("Do not confuse audience with scope, permission, product ID, client ID"). It is:

- **Accepted at CREATE time**: `CreateApplicationDto.audiences?: string[]` (`src/modules/applications/dto/create-application.dto.ts`) — optional, defaults to `[]`.
- **Accepted at UPDATE time**: `UpdateApplicationDto.audiences?: string[]` — a follow-up `PATCH` can add/replace the list.
- **Validated** by a dedicated policy class, `ApplicationAudiencePolicy.validateAudiencesForRegistration()` (`src/modules/applications/policies/audience.policy.ts`): rejects an empty-string entry, rejects `'*'`/`'all'`/`'any'` (case-insensitive) or any value containing `*`, rejects duplicates. Called from `ApplicationsService.validateConfiguration()` on **both** create and update paths.
- **Enforced at token issuance**: `AuthorizeService` requires an explicit `audience` parameter on every `/oauth/authorize` request (`400 audience is required` if omitted — verified live, `docs/NEW_PRODUCT_ONBOARDING_WALKTHROUGH.md` §4.2) and checks it against the Application's own `audiences` allow-list via `ApplicationAudiencePolicy.isAudienceAllowed()` — exact match only, `400 audience_not_allowed` otherwise.
- **Carried into the issued token's `aud` claim** — the resource server's own authoritative isolation signal (verified live in the same walkthrough's §5: a token minted for one audience is rejected outright, generic `401 invalid_token`, by a resource server expecting a different one).

## 2. Correction to Phase 2UI.1's own product-onboarding wizard design

`docs/PRODUCT_ONBOARDING_UX.md` §1/§2 states that the wizard's "Audiences" step requires a *second* API call (`PATCH` after the initial `POST .../applications`), reasoning that `CreateApplicationDto` didn't accept the field at creation time. **That specific implementation detail was incorrect** — re-verified directly against the DTO source during this phase: `audiences` was always accepted at creation. The error traces back to how that document's own live walkthrough was performed: the demo's creation call simply didn't happen to include an `audiences` field in its request body (an omission in the walkthrough script, not a genuine API limitation), and a follow-up `PATCH` was used instead, which then read as "creation doesn't support this field."

**What remains entirely correct and unchanged**: the *core UX finding* — that an Application must have `audiences` configured or every real login attempt against it fails with a live, verified `400 audience is required` — is accurate and important regardless of which HTTP call sets the field. A wizard **must** include an explicit Audiences step (or default sensibly) or ship a silently-broken Application. Only the "requires a second network call" implementation detail was wrong; the wizard can set `audiences` in the exact same `POST .../applications` call that creates the Application, no follow-up `PATCH` structurally required. `docs/PRODUCT_ONBOARDING_UX.md` is not rewritten by this phase (documentation-only correction, recorded here rather than silently propagated) — a future UI-implementation phase should build the wizard using this document's corrected understanding.

## 3. Why this document exists despite requiring zero new code

This phase's own governing instruction was explicit: *"Do not blindly add another field if an existing audience model already exists... inspect the current Application model and contract. Determine exactly where audience configuration belongs."* Doing that inspection thoroughly is what surfaced that no new field, validation, or wiring was needed — the honest, correct output of "investigate gap #4" turned out to be "confirm it isn't a gap," not a new endpoint. Silently skipping documentation because no code changed would let Phase 2UI.1's minor over-claim persist uncorrected.

## 4. Regression lock

`tests/phase2ui2-admin-foundation-credential-lifecycle.e2e-spec.ts` § "Audience configuration (already implemented — regression lock)" asserts, against the real running API: (1) `audiences` is accepted and persisted at `POST .../applications` creation time, and (2) a wildcard audience is rejected at creation time. These tests exist specifically so a future refactor can't silently regress this already-correct behavior without a test failure.

## 5. Frontend contract

No new endpoint or field for the future Admin Console to integrate against — the existing `ApplicationFormDrawer`-equivalent creation form can simply include an "Audiences" input alongside Scopes/Redirect URIs/Grant Types in the same single submission, exactly as `docs/PRODUCT_ONBOARDING_UX.md`'s corrected step list (§2 above) describes.
