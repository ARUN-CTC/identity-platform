/**
 * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Consent boundary, brief
 * §10) — the FUTURE architectural seam for third-party-application
 * consent, defined now so it exists as a clean extension point, but
 * completely INERT in this phase: nothing in `AuthorizeService` (or
 * anywhere else in this codebase) constructs, registers, calls, or even
 * imports a `ConsentPolicy` implementation. No registry exists for it
 * (unlike `ResourceAuthorizationPolicyRegistry`, Phase 2D.6, which IS
 * actually wired into a real guard) — introducing one now, unused, would
 * be exactly the "fake persistent consent" the brief warns against.
 *
 * Today's actual behavior (unchanged by this interface's existence):
 *
 * ```text
 * First-party trusted application (every Application registered today)
 *         ↓
 * existing authorization policy (OAuthApplicationPolicyService, Phase 2D.2)
 *         ↓
 * authorization code (Phase 2D.7) — issued without any consent step
 * ```
 *
 * The seam this interface reserves, for a FUTURE phase, once a real
 * third-party application is a named requirement:
 *
 * ```text
 * Third-party application
 *         ↓
 * user consent (a ConsentPolicy implementation, evaluated at /authorize,
 *                after the existing OAuthApplicationPolicyService checks —
 *                never replacing them)
 *         ↓
 * grant/consent record (a future, genuinely new table — NOT introduced
 *                        by this phase)
 *         ↓
 * authorization code — unchanged issuance mechanism, unchanged table
 * ```
 *
 * A future phase wiring this in must NOT create a second authorization
 * mechanism — `ConsentPolicy` answers exactly one question ("did/does this
 * user consent to this client using these scopes"), entirely upstream of,
 * and never a substitute for, every check `AuthorizeService` already
 * performs (client/redirect_uri/PKCE/scope/audience/organization/tenant/
 * entitlement).
 */
export interface ConsentContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly applicationId: string;
  readonly clientId: string;
  readonly requestedScopes: readonly string[];
  readonly organizationId: string | null;
}

export interface ConsentDecision {
  readonly allowed: boolean;
  readonly reasonCode?: string;
}

export interface ConsentPolicy {
  evaluate(context: ConsentContext): Promise<ConsentDecision>;
}
