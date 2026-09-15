import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, configureApiClient, ApiError } from "@/shared/api";

/**
 * Every response mocked here mirrors the REAL backend, confirmed live
 * against a running instance (2026-09-16): a success response IS the
 * resource/list directly (no envelope — `ResponseInterceptor` exists in
 * the backend source but is never registered in `main.ts`), and a failure
 * is NestJS's own default `{statusCode, message, error?}` shape. See
 * `client.ts`'s own `NestErrorBody` doc comment.
 */
describe("apiRequest", () => {
  beforeEach(() => {
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a successful response's body verbatim — there is no envelope to unwrap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiRequest<{ id: string }>("/tenants/1");

    expect(result).toEqual({ id: "1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/tenants/1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("serializes query params, dropping empty/undefined values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/users", { query: { page: 1, search: "", status: undefined, limit: 20 } });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("page")).toBe("1");
    expect(calledUrl.searchParams.get("limit")).toBe("20");
    expect(calledUrl.searchParams.has("search")).toBe(false);
    expect(calledUrl.searchParams.has("status")).toBe(false);
  });

  it("returns undefined for an empty response body (e.g. 204/logout) without treating it as a parse failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const result = await apiRequest("/auth/logout", { method: "POST" });
    expect(result).toBeUndefined();
  });

  it("throws ApiError with the backend's message on a validation failure (message as an array — ValidationPipe's real shape)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            statusCode: 400,
            message: ["tenantCode must contain only uppercase letters, numbers, underscores, and hyphens"],
            error: "Bad Request",
          }),
          { status: 400 },
        ),
      ),
    );

    await expect(apiRequest("/tenants", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "tenantCode must contain only uppercase letters, numbers, underscores, and hyphens",
    });
  });

  it("flags a 409 response as a conflict (AppException's real shape — message as a plain string, no `error` key)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ statusCode: 409, message: "Stale version" }), { status: 409 })),
    );

    try {
      await apiRequest("/tenants/1", { method: "PUT", body: { version: 1 } });
      expect.unreachable("apiRequest should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).isConflict).toBe(true);
    }
  });

  it("wraps a network failure in an ApiError instead of throwing raw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(apiRequest("/tenants")).rejects.toBeInstanceOf(ApiError);
  });

  describe("ApiError status classification", () => {
    async function requestWithStatus(status: number, message = "error") {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ statusCode: status, message }), { status })));
      try {
        await apiRequest("/users");
        expect.unreachable("apiRequest should have thrown");
      } catch (error) {
        return error as ApiError;
      }
    }

    it("flags 401 as unauthorized", async () => {
      const error = await requestWithStatus(401, "Missing bearer access token");
      expect(error.isUnauthorized).toBe(true);
      expect(error.isForbidden).toBe(false);
    });

    it("flags 403 as forbidden", async () => {
      const error = await requestWithStatus(403);
      expect(error.isForbidden).toBe(true);
      expect(error.isUnauthorized).toBe(false);
    });

    it("flags 404 as not found", async () => {
      const error = await requestWithStatus(404, "User not found");
      expect(error.isNotFound).toBe(true);
    });

    it("flags 422 as a validation error alongside 400", async () => {
      const error = await requestWithStatus(422);
      expect(error.isValidationError).toBe(true);
    });

    it("flags 500 as a server error", async () => {
      const error = await requestWithStatus(500);
      expect(error.isServerError).toBe(true);
    });
  });
});

describe("401 handling (onUnauthorized retry)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function response(status: number, data: unknown = undefined) {
    const body = status < 300 ? data : { statusCode: status, message: "msg" };
    return new Response(JSON.stringify(body), { status });
  }

  it("retries once after onUnauthorized resolves with a new token, and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const onUnauthorized = vi.fn().mockResolvedValue({ accessToken: "new-token" });
    configureApiClient({ baseUrl: "http://test.local/api/v1", onUnauthorized });

    const result = await apiRequest<{ ok: boolean }>("/organizations");

    expect(result).toEqual({ ok: true });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws the original 401 as ApiError when onUnauthorized can't recover", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401)));
    const onUnauthorized = vi.fn().mockResolvedValue(null);
    configureApiClient({ baseUrl: "http://test.local/api/v1", onUnauthorized });

    await expect(apiRequest("/organizations")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent 401s into a single onUnauthorized call — refresh tokens are single-use", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { a: 1 }))
      .mockResolvedValueOnce(response(200, { b: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    let resolveRefresh!: (value: { accessToken: string }) => void;
    const onUnauthorized = vi.fn().mockReturnValue(new Promise((resolve) => (resolveRefresh = resolve)));
    configureApiClient({ baseUrl: "http://test.local/api/v1", onUnauthorized });

    const first = apiRequest("/organizations");
    const second = apiRequest("/users");
    resolveRefresh({ accessToken: "new-token" });

    await Promise.all([first, second]);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("never retries /auth/login or /auth/refresh themselves on a 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(401));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn().mockResolvedValue({ accessToken: "new-token" });
    configureApiClient({ baseUrl: "http://test.local/api/v1", onUnauthorized });

    await expect(apiRequest("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("buildContextHeaders", () => {
  it("only sends headers for context values that are present", async () => {
    const { buildContextHeaders } = await import("@/shared/api");

    expect(buildContextHeaders({})).toEqual({});
    expect(buildContextHeaders({ accessToken: "abc" })).toEqual({ Authorization: "Bearer abc" });
    expect(
      buildContextHeaders({ accessToken: "abc", tenantId: "t1", userId: "u1", organizationId: "o1" }),
    ).toEqual({
      Authorization: "Bearer abc",
      "X-Tenant-Id": "t1",
      "X-User-Id": "u1",
      "X-Organization-Id": "o1",
    });
  });

  it("apiRequest attaches whatever configureApiClient's getContext currently returns", async () => {
    const session: { token: string | undefined } = { token: undefined };
    configureApiClient({
      baseUrl: "http://test.local/api/v1",
      getContext: () => ({ accessToken: session.token }),
    });

    // A fresh Response per call — Response bodies can only be read once,
    // and this test calls apiRequest twice against the same mock.
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(null), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/users");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty("Authorization");

    session.token = "fresh-token";
    await apiRequest("/users");
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer fresh-token" });

    vi.unstubAllGlobals();
  });
});
