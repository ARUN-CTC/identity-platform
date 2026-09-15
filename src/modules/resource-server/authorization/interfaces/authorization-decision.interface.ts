/**
 * Phase 2D.6 (docs/RESOURCE_AUTHORIZATION_CONTRACT.md) — the explicit,
 * typed result of a product's own authorization decision. Deliberately
 * never collapsed to a bare boolean at any point in the pipeline — even
 * where only `allowed` ultimately matters for the HTTP response, the
 * `reasonCode` is preserved through to the (never client-visible)
 * observability log, so a denial's specific cause is never silently lost.
 *
 * `allowed` must be checked with `=== true`, never truthy-coerced — a
 * policy returning `{}` or `{allowed: undefined}` (a buggy or incomplete
 * implementation) is treated as a denial, never as an accidental allow
 * (brief §23: fail closed on ambiguity).
 */
export interface AuthorizationDecision {
  readonly allowed: boolean;

  /** Product-defined, opaque to the Identity Platform — never interpreted, only logged/observed. */
  readonly reasonCode?: string;

  /** The scope the policy determined was missing, if applicable — informational only, never re-derived by the guard. */
  readonly requiredScope?: string;

  /** The product-owned IAM permission code the policy determined was missing, if applicable. Never a value the Identity Platform defines or recognizes (brief §4/§30). */
  readonly requiredPermission?: string;
}

/** The one, canonical "no" — used by the guard itself for every fail-closed path (missing policy, provider error, ambiguous claim) so every such path is provably identical in shape. */
export function denied(reasonCode: string): AuthorizationDecision {
  return { allowed: false, reasonCode };
}
