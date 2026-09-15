import { ApiError } from "./types";

/**
 * User-facing message for any ApiError — never the raw error/stack, and a
 * friendlier fallback for the cases whose backend message wouldn't mean
 * anything to a non-technical user (401/403/5xx/network). Shared by every
 * mutation/notify error handling across the app.
 */
export function getApiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong";

  if (error.isUnauthorized) return "Your session has expired. Please sign in again.";
  if (error.isForbidden) return "You don't have permission to do that.";
  if (error.isNetworkError) return "Network error — could not reach the server.";
  if (error.isServerError) return "Something went wrong on our end. Please try again.";

  // 400/404/409/422 backend messages are already written for end users
  // (see AllExceptionsFilter) — safe to show directly.
  return error.message;
}
