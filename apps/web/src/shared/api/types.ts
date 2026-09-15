/**
 * ⚠ Not actually applied by the running backend — confirmed live
 * (2026-09-16): `src/common/interceptors/response.interceptor.ts` and
 * `src/common/filters/all-exceptions.filter.ts` implement exactly this
 * shape, but neither is registered anywhere (`main.ts` never calls
 * `app.useGlobalInterceptors`/`app.useGlobalFilters` for them) — a real
 * request returns its resource/list body raw, and an error returns
 * NestJS's own default `{statusCode, message, error?}` shape (see
 * `client.ts`'s `NestErrorBody`, the type `apiRequest()` actually parses).
 * The backend's own e2e suite already reads every response this way
 * (`res.body.x`, never `res.body.data.x`). Kept only as a record of the
 * backend's own documented (but unwired) intent — nothing in this app
 * constructs or unwraps this shape anymore.
 */
export interface ResponseEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  errors: string[];
  traceId: string;
  timestamp: string;
}

/** Mirrors src/common/dto/paginated-result.ts (if/when a list endpoint adopts it). */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface ListParams {
  // An index signature so any params object (this interface or one
  // extending it, e.g. UserListParams/RoleListParams) can be passed
  // straight through as `apiRequest`'s `query` — every field on every
  // extension must stay assignable to this union.
  [key: string]: string | number | boolean | undefined | null;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * Thrown for both network failures and non-2xx API responses. `errors`
 * carries the backend's `"CODE: message"` strings (see AllExceptionsFilter)
 * for callers that need the machine-readable code, e.g. detecting a 409
 * optimistic-lock conflict to prompt a refetch-and-retry.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: string[];
  readonly traceId?: string;

  constructor(message: string, status: number, errors: string[] = [], traceId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.traceId = traceId;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isValidationError(): boolean {
    return this.status === 400 || this.status === 422;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}
