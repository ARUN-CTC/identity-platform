/**
 * Safe, categorical failure reasons for external (RS256) token verification —
 * used for structured logging/observability without ever needing to log a
 * raw token or its claims (Phase 2D.1 brief §27: "Do not log raw JWT
 * contents"). Every branch of ExternalTokenService.verify() throws one of
 * these, never a raw jsonwebtoken error, so callers/logs get a stable,
 * enumerable reason code instead of a library-specific message string.
 */
export type ExternalTokenErrorCode =
  | 'invalid_token'
  | 'invalid_signature'
  | 'invalid_algorithm'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'unknown_kid'
  | 'expired_token'
  | 'not_yet_valid';

export class ExternalTokenError extends Error {
  constructor(
    public readonly code: ExternalTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalTokenError';
  }
}
