import { ApiError } from "@/shared/api";

/**
 * The one reusable authentication error → safe UX message mapping (brief
 * §16), used by LoginForm. Every 401/403 this platform's own auth
 * endpoints throw already carries a safe, deliberately generic-where-it-
 * matters message (see AuthenticationService — wrong password/unknown
 * email/unknown tenant are all collapsed into one "Invalid credentials"
 * precisely to prevent account enumeration; a locked or disabled account
 * gets its own specific, safe, actionable message) — so this function's
 * job is narrower than the brief's own example table suggests: pass those
 * messages through verbatim, and only substitute a generic message for
 * cases the backend's own message would be unsafe or unhelpful to show
 * as-is (network failures, 5xx).
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
