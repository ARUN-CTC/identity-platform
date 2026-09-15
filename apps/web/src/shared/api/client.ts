import { buildContextHeaders, type RequestContext } from "./context";
import { ApiError } from "./types";

/**
 * NestJS's own default `HttpException` JSON body — the actual, real shape
 * of every response this backend sends. `src/common/interceptors/response.interceptor.ts`
 * and `src/common/filters/all-exceptions.filter.ts` exist in the backend
 * source (a documented, designed `{success, message, data, errors, traceId,
 * timestamp}` envelope) but are never registered in `main.ts`
 * (`app.useGlobalInterceptors`/`app.useGlobalFilters` — neither call
 * exists) — confirmed live against a running instance, and consistent
 * with the backend's own e2e suite, which reads every response body raw
 * (`res.body.x`, never `res.body.data.x`). A success response is the raw
 * resource/list itself; a failure is this shape. `message` is a single
 * string for most errors, but an array of strings for ValidationPipe
 * failures (one entry per failed field).
 */
interface NestErrorBody {
  statusCode: number;
  message?: string | string[];
  error?: string;
}

interface ApiClientConfig {
  baseUrl: string;
  /**
   * Resolved fresh on every request (not read once at configure-time) so a
   * later login/organization-switch/logout takes effect immediately without
   * needing to reconfigure the client — see config.ts.
   */
  getContext?: () => RequestContext;
  /**
   * Called on a 401 from any endpoint other than /auth/login or
   * /auth/refresh themselves. Must attempt to obtain a fresh access token
   * (via config.ts's own refresh-token flow) and return it, or return null
   * if that's not possible (no refresh token, refresh itself failed) —
   * apiRequest retries the original request once on a non-null result,
   * otherwise lets the original 401 propagate as an ApiError. The consuming
   * app is responsible for clearing session/redirecting on failure — this
   * module stays framework-agnostic and never navigates or touches storage
   * itself.
   */
  onUnauthorized?: () => Promise<{ accessToken: string } | null>;
}

let config: ApiClientConfig = { baseUrl: "http://localhost:3000/api/v1" };

/** Call once at app startup to point the client at the right backend and give it a way to read the current request context. */
export function configureApiClient(next: ApiClientConfig): void {
  config = next;
}

export function getApiBaseUrl(): string {
  return config.baseUrl;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** A plain object is JSON-encoded. Pass a real `FormData` instance for multipart uploads — the browser sets the correct `Content-Type` (including the boundary) on its own; this function must not set one itself in that case. */
  body?: unknown | FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Extra headers merged in after the standard context headers (so a caller can't accidentally clobber auth/tenant headers this way). */
  headers?: Record<string, string>;
  /** Internal — set by apiRequest's own 401-retry logic; never pass this yourself. */
  skipUnauthorizedRetry?: boolean;
}

/**
 * At most one refresh in flight at a time, shared by every concurrent 401 —
 * required because refresh tokens are single-use/rotate-on-use (see
 * AuthenticationService.refresh() on the backend): two independent refresh
 * calls racing on the same token would have the second one rejected as
 * reuse, killing the whole session instead of just retrying a request.
 */
let refreshInFlight: Promise<{ accessToken: string } | null> | null = null;

function isAuthBoundaryPath(path: string): boolean {
  return path === "/auth/login" || path === "/auth/refresh";
}

async function attemptRefresh(): Promise<{ accessToken: string } | null> {
  if (!config.onUnauthorized) return null;
  if (!refreshInFlight) {
    refreshInFlight = config.onUnauthorized().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
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
 * The one place every API call funnels through: attaches request-context
 * headers (auth/tenant/user/org — only the ones actually present, see
 * context.ts), and throws `ApiError` for both network failures and non-2xx
 * responses so callers only ever deal with "got data" or "caught
 * ApiError". Domain modules must never build these headers themselves —
 * that's exactly what this function centralizes.
 *
 * There is no envelope to unwrap (see NestErrorBody's own doc comment
 * above) — a successful response's parsed JSON body IS the value this
 * function returns, verbatim.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal } = options;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...buildContextHeaders(config.getContext?.() ?? {}),
    ...options.headers,
  };

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    throw new ApiError("Network error — could not reach the server", 0, [], undefined);
  }

  if (response.status === 401 && !options.skipUnauthorizedRetry && !isAuthBoundaryPath(path)) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipUnauthorizedRetry: true });
    }
  }

  // A 204/empty body parses to `undefined` here — real for DELETE/some
  // POST actions (e.g. logout) — never treated as a parse failure.
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
