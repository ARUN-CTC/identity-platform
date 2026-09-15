/**
 * Mirrors the backend's response envelope exactly (see
 * src/common/interceptors/response-envelope.interface.ts) — every endpoint,
 * success or failure, returns this shape.
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
