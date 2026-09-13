import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Phase 2D.4 (docs/EXTERNAL_API_TRUST_BOUNDARY.md §2, RFC 6749 §5.2) — the
 * `POST /oauth/token` error response shape. Deliberately NOT `AppException`
 * (`src/common/exceptions/app.exception.ts`): this platform's own envelope
 * (`{success, message, data, errors, traceId, timestamp}`) is not what an
 * OAuth-conformant client expects at a token endpoint — every response body
 * from this controller must be exactly `{error, error_description}` (RFC
 * 6749), which `HttpException`'s own `getResponse()` already returns
 * verbatim when constructed with a plain object, with no envelope-wrapping
 * filter in the way (`AllExceptionsFilter` is not globally registered
 * anywhere in this codebase — a separate, pre-existing, already-documented
 * fact this class relies on rather than fights).
 *
 * `code` is the standard OAuth `error` value; the HTTP status and whether
 * `WWW-Authenticate: Basic` is attached are both fixed per code (see
 * `OAuthTokenErrorFilter`) rather than left to each call site to get
 * consistently right.
 */
export type OAuthTokenErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'access_denied'
  // Phase 2D.7 (RFC 6749 §5.2) — the authorization_code grant's own denial
  // code at `/token`: an unknown/expired/already-consumed/malformed code,
  // or a code presented with the wrong client/redirect_uri/PKCE verifier.
  // Deliberately one generic code for every one of those reasons (brief
  // §40/§43 — never let a caller distinguish "expired" from "already used"
  // from "wrong verifier" from "never existed"); the specific reason is
  // recorded only in the (never client-visible) audit metadata, exactly
  // the same non-enumeration discipline `ClientCredentialsService` already
  // applies to `access_denied`.
  | 'invalid_grant'
  // Phase 2D.7 (RFC 6749 §4.1.2.1) — `/authorize`'s own error code for a
  // `response_type` other than `code` (brief §7). Not used at `/token`.
  | 'unsupported_response_type';

const STATUS_FOR_CODE: Record<OAuthTokenErrorCode, HttpStatus> = {
  invalid_request: HttpStatus.BAD_REQUEST,
  invalid_client: HttpStatus.UNAUTHORIZED,
  unauthorized_client: HttpStatus.BAD_REQUEST,
  unsupported_grant_type: HttpStatus.BAD_REQUEST,
  invalid_scope: HttpStatus.BAD_REQUEST,
  invalid_target: HttpStatus.BAD_REQUEST,
  access_denied: HttpStatus.FORBIDDEN,
  invalid_grant: HttpStatus.BAD_REQUEST,
  unsupported_response_type: HttpStatus.BAD_REQUEST,
};

export class OAuthTokenError extends HttpException {
  constructor(
    public readonly code: OAuthTokenErrorCode,
    description: string,
  ) {
    super({ error: code, error_description: description }, STATUS_FOR_CODE[code]);
  }
}
