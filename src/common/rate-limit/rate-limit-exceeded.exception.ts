import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Phase 2D.9 — a single, protocol-agnostic 429 response shape
 * (`{error, error_description}`), reused identically across every
 * rate-limited OAuth/OIDC route. No global exception filter is registered
 * in this codebase (see `OAuthTokenError`'s own doc comment) — a plain
 * `HttpException` constructed with a plain object body already serializes
 * exactly as `{error, error_description}` with no extra filter needed,
 * the same reason `OAuthTokenError`/`ResourceServerAuthError` don't need
 * one either for their own body shape.
 *
 * Deliberately NOT `OAuthTokenError`/`ResourceServerAuthError` themselves
 * (which live in the `oauth`/`resource-server` feature modules) — this
 * class lives in `common` specifically so the generic rate-limiting guard
 * never has to import a feature module to report its own denial.
 */
export class RateLimitExceededException extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super({ error: 'temporarily_unavailable', error_description: 'Rate limit exceeded — retry later' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
