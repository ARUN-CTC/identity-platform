import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Phase 2D.5 (docs/RESOURCE_SERVER_ARCHITECTURE.md §Error model, RFC 6750
 * §3) — the Bearer-token resource-server error shape. Every code below
 * collapses to a generic, non-distinguishing message externally (brief §23:
 * "do not expose cryptographic internals... do not leak whether
 * ServiceAccount/Tenant/Application/Grant exists") — the SPECIFIC reason
 * (unknown kid, wrong issuer, expired, wrong audience, ...) is available
 * only via the internal `ResourceServerErrorReason` passed to the request
 * logger, never via the HTTP response body itself.
 *
 * Deliberately a distinct class from `OAuthTokenError` (Phase 2D.4, `/oauth
 * /token`'s own RFC 6749 `{error,error_description}` shape) — RFC 6750
 * (Bearer token usage) is a different spec than RFC 6749 §5.2 (token
 * endpoint errors), with its own `WWW-Authenticate` challenge-parameter
 * conventions; conflating the two would blur which spec a given response
 * actually conforms to.
 */
export type ResourceServerErrorCode = 'invalid_request' | 'invalid_token' | 'insufficient_scope' | 'forbidden';

/** The one, generic, externally-visible description for every `invalid_token` denial — never varies by internal reason (brief §23/§36). */
export const GENERIC_INVALID_TOKEN_MESSAGE = 'The access token is invalid, expired, or not recognized';

/**
 * Fine-grained, NEVER-externally-visible reason — used only for structured
 * logging (`docs/RESOURCE_SERVER_ARCHITECTURE.md` §Observability) and, where
 * applicable, internal test assertions. Every value here maps to exactly
 * one of the three public `ResourceServerErrorCode`s above.
 */
export type ResourceServerErrorReason =
  | 'missing_bearer'
  | 'malformed_bearer'
  | 'ambiguous_authorization_header'
  | 'unsupported_scheme'
  | 'malformed_token'
  | 'unsupported_algorithm'
  | 'missing_kid'
  | 'unknown_kid'
  | 'invalid_signature'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'expired_token'
  | 'not_yet_valid'
  | 'missing_required_claim'
  | 'malformed_claim'
  | 'insufficient_scope'
  | 'jwks_unavailable'
  // Phase 2D.8 (docs/OIDC_PROVIDER.md §2, brief §26-28) — an OIDC ID Token
  // (`token_use: 'id_token'`) presented as a bearer access token. Maps to
  // the same public `invalid_token` code as every other authentication
  // failure — never a distinct signal that would help an attacker learn
  // "this credential is real, just the wrong kind."
  | 'id_token_not_accepted'
  // Phase 2D.6 (docs/RESOURCE_AUTHORIZATION_CONTRACT.md) — authorization-
  // layer (not authentication-layer) denial reasons. All map to the
  // `forbidden` public code (403) — distinct from `insufficient_scope`
  // (also 403) so a scope failure and a product-IAM/policy failure are
  // never conflated even internally, though both are equally generic
  // externally (brief §24: never reveal which specific layer denied).
  | 'missing_principal'
  | 'missing_authorization_metadata'
  | 'no_policy_registered'
  | 'authorization_provider_error'
  | 'authorization_denied';

const STATUS_FOR_CODE: Record<ResourceServerErrorCode, HttpStatus> = {
  invalid_request: HttpStatus.BAD_REQUEST,
  invalid_token: HttpStatus.UNAUTHORIZED,
  insufficient_scope: HttpStatus.FORBIDDEN,
  forbidden: HttpStatus.FORBIDDEN,
};

export class ResourceServerAuthError extends HttpException {
  constructor(
    public readonly code: ResourceServerErrorCode,
    public readonly reason: ResourceServerErrorReason,
    description: string,
  ) {
    super({ error: code, error_description: description }, STATUS_FOR_CODE[code]);
  }
}
