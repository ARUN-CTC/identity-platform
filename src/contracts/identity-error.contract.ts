/**
 * Phase 2D.10 (docs/IDENTITY_EXTERNAL_API_CONTRACT.md §Errors) — the
 * stable, product-facing authentication/authorization error vocabulary.
 * Re-exports the EXISTING, already-tested error codes (Phase 2D.4-2D.6) —
 * introduces no new code, renames none. A product's own resource server
 * (a genuinely separate process — see `identity-entitlement.contract.ts`)
 * cannot import `ResourceServerAuthError`/`OAuthTokenError` themselves
 * (they are NestJS `HttpException` subclasses tied to this platform's own
 * process), but every response body they produce is exactly
 * `{error: <code>, error_description: <generic text>}` — this file exports
 * the `code` union as the stable, language-agnostic contract a product
 * written in ANY stack can pattern-match against.
 */
export type { ResourceServerErrorCode as IdentityBearerErrorCode } from '../modules/resource-server/errors';
export type { OAuthTokenErrorCode as IdentityTokenEndpointErrorCode } from '../modules/oauth/errors';

/**
 * The stable HTTP-status classification for `IdentityBearerErrorCode` —
 * restated here (not imported) because the source `STATUS_FOR_CODE` map in
 * `resource-server-error.ts` is intentionally not exported (it is an
 * internal implementation detail of `ResourceServerAuthError`'s
 * constructor) — this is the documented, external, contractual promise a
 * product may rely on, verified against that internal map by
 * `identity-error.contract.spec.ts`.
 *
 * `invalid_request` → 400, `invalid_token` → 401, `insufficient_scope` /
 * `forbidden` → 403. A product must treat 401 as "re-authenticate" and 403
 * as "this identity is known but not allowed" — never the same branch.
 */
export const IDENTITY_BEARER_ERROR_HTTP_STATUS: Record<'invalid_request' | 'invalid_token' | 'insufficient_scope' | 'forbidden', number> = {
  invalid_request: 400,
  invalid_token: 401,
  insufficient_scope: 403,
  forbidden: 403,
};
