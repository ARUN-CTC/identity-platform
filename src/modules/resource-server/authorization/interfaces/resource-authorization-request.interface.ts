/**
 * Phase 2D.6 — what a protected route asks a registered product policy to
 * decide. Every field here is an OPAQUE STRING as far as the Identity
 * Platform is concerned — `productId`/`resource`/`action` are never
 * validated, interpreted, or given meaning by anything in this module
 * (brief §9: "The Identity Platform must remain unaware of booking,
 * customer, flight, hotel, patient, member, appointment"). Only the
 * product's own registered `ResourceAuthorizationPolicy` gives them
 * meaning.
 */
export interface ResourceAuthorizationRequest {
  /** The opaque key a product registered its policy under (`ResourceAuthorizationPolicyRegistry.register(productId, ...)`). Never a Prisma `Product.id` unless a policy implementation chooses to treat it as one. */
  readonly productId: string;

  readonly resource: string;

  readonly action: string;

  /** Convenience — the same OAuth scopes already on `ResourceAuthorizationContext.scopes`, threaded through so a policy can factor them into its own decision without a second lookup. Enforcement of these (Layer 5) happens in the guard BEFORE the policy is ever called — see `ResourceAuthorizationGuard`. */
  readonly requiredScopes?: string[];

  /** Product-owned IAM permission codes — opaque to the Identity Platform, meaningful only to the policy that receives them. */
  readonly requiredPermissions?: string[];
}
