import { ApiError } from "@/shared/api";

/**
 * The one reusable authentication error → safe UX message mapping (brief
 * §16), used by LoginForm and OAuthAuthorizePage. Every 401/403 this
 * platform's own auth endpoints throw already carries a safe, deliberately
 * generic-where-it-matters message (see AuthenticationService — wrong
 * password/unknown email/unknown tenant are all collapsed into one
 * "Invalid credentials" precisely to prevent account enumeration; a locked
 * or disabled account gets its own specific, safe, actionable message) — so
 * this function's job is narrower than the brief's own example table
 * suggests: pass those messages through verbatim, and only substitute a
 * generic message for cases the backend's own message would be unsafe or
 * unhelpful to show as-is (network failures, 5xx, and the OAuth-specific
 * RFC 6749 `error` codes, which are machine-oriented strings never meant
 * for an end user to read directly).
 */
export function getAuthErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }
  if (error.isNetworkError) {
    return "Unable to connect. Check your connection and try again.";
  }
  if (error.isRateLimited) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (error.isServerError) {
    return "Something went wrong on our end. Please try again.";
  }
  // Every other status from /auth/* (login, refresh, password reset,
  // invitations, context switch) already carries a safe, specific message —
  // see this file's own header comment.
  return error.message;
}

/**
 * OAuth `/oauth/authorize` denials arrive as RFC 6749 `error` codes
 * (`invalid_request`, `unauthorized_client`, `access_denied`,
 * `invalid_scope`, `invalid_target`, `unsupported_response_type`,
 * `temporarily_unavailable`) — machine-oriented strings, never shown to a
 * user directly (brief §16's own example table). This is the ONE place
 * that maps them to safe UX copy; `error_description` from the backend is
 * deliberately never displayed verbatim here even though it is itself
 * already-sanitized (never a stack trace/internal id) — because it is
 * written for a developer integrating a client, not for the end user
 * completing a sign-in.
 */
export function getOAuthErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "invalid_request":
    case "unsupported_response_type":
      return "Unable to process this sign-in request.";
    case "unauthorized_client":
    case "invalid_client":
      return "Unable to start sign-in for this application.";
    case "access_denied":
      return "Access denied.";
    case "invalid_scope":
      return "The requested access is unavailable.";
    case "invalid_target":
      return "The requested access is unavailable.";
    case "temporarily_unavailable":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return "Unable to process this sign-in request.";
  }
}
