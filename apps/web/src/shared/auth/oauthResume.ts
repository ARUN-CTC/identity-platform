import { getApiBaseUrl } from "@/shared/api";

/**
 * Builds the URL for a real top-level browser navigation (never
 * fetch/XHR) back to the backend's `GET /oauth/authorize/resume`. `ref` is
 * the opaque, single-use, server-issued pending-authorization reference —
 * never a raw OAuth parameter, never a return-to URL — see
 * docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md.
 */
export function buildAuthorizeResumeUrl(ref: string): string {
  const url = new URL(`${getApiBaseUrl()}/oauth/authorize/resume`);
  url.searchParams.set("ref", ref);
  return url.toString();
}
