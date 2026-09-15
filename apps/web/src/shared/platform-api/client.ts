import { ApiError } from "../api/types";

/**
 * A deliberately SEPARATE, minimal fetch wrapper for the Platform Operator
 * boundary — not a re-export of `shared/api/client.ts`'s `apiRequest`.
 *
 * Platform Operator authentication is a structurally distinct security
 * boundary from tenant authentication (its own login, its own token
 * issuer/claims shape, its own refresh-token table, no tenant/organization
 * context ever) — see `src/modules/platform-operators/` on the backend.
 * Blindly reusing the tenant client's single-flight-refresh/session-expiry
 * machinery here would risk coupling the two boundaries (e.g. a platform
 * 401 accidentally triggering a *tenant* refresh, or vice versa, if the two
 * ever shared module-level state). This file only reuses what's genuinely
 * shape-only and boundary-agnostic: `ApiError` from `shared/api/types.ts`.
 *
 * Never sends `X-Tenant-Id`/`X-User-Id`/`X-Organization-Id` — a Platform
 * Operator has no tenant context, ever; the only header this client attaches
 * is `Authorization: Bearer <platform access token>`.
 *
 * No response envelope to unwrap — confirmed live against a running
 * backend (2026-09-16): a success response's body IS the resource/list
 * directly, and a failure is NestJS's own default `{statusCode, message,
 * error?}` shape (see `shared/api/client.ts`'s `NestErrorBody` for the
 * identical parsing this file mirrors).
 */
interface NestErrorBody {
  statusCode: number;
  message?: string | string[];
  error?: string;
}
interface PlatformApiClientConfig {
  baseUrl: string;
  getAccessToken?: () => string | undefined;
  /** Called on a 401 from any endpoint other than platform login/refresh themselves. Must attempt to obtain a fresh platform access token, or return null if that's not possible. */
  onUnauthorized?: () => Promise<{ accessToken: string } | null>;
}

let config: PlatformApiClientConfig = { baseUrl: "http://localhost:3000/api/v1" };

export function configurePlatformApiClient(next: PlatformApiClientConfig): void {
  config = next;
}

export interface PlatformRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Internal — set by platformApiRequest's own 401-retry logic; never pass this yourself. */
  skipUnauthorizedRetry?: boolean;
}

let refreshInFlight: Promise<{ accessToken: string } | null> | null = null;

async function attemptRefresh(): Promise<{ accessToken: string } | null> {
  if (!config.onUnauthorized) return null;
  if (!refreshInFlight) {
    refreshInFlight = config.onUnauthorized().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function isAuthBoundaryPath(path: string): boolean {
  return path === "/platform/auth/login" || path === "/platform/auth/refresh";
}

function buildUrl(path: string, query?: PlatformRequestOptions["query"]): string {
  const url = new URL(`${config.baseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * The one place every Platform Operator API call funnels through: attaches
 * the platform bearer token and throws `ApiError` for both network
 * failures and non-2xx responses — the same error contract the tenant
 * client uses, carried by an independent implementation. A successful
 * response's parsed JSON body is returned verbatim; there is no envelope.
 */
export async function platformApiRequest<T>(path: string, options: PlatformRequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal } = options;

  const accessToken = config.getAccessToken?.();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    throw new ApiError("Network error — could not reach the server", 0, [], undefined);
  }

  if (response.status === 401 && !options.skipUnauthorizedRetry && !isAuthBoundaryPath(path)) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      return platformApiRequest<T>(path, { ...options, skipUnauthorizedRetry: true });
    }
  }

  const raw = await response.text();
  const parsed = raw ? (JSON.parse(raw) as unknown) : undefined;

  if (!response.ok) {
    const errorBody = parsed as NestErrorBody | undefined;
    const messages = Array.isArray(errorBody?.message)
      ? errorBody.message
      : errorBody?.message
        ? [errorBody.message]
        : [`Request failed with status ${response.status}`];
    throw new ApiError(messages[0], response.status, messages, undefined);
  }

  return parsed as T;
}
