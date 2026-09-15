import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureApiClient } from "./client";
import {
  activateUser,
  createUser,
  deactivateUser,
  deleteUser,
  getUser,
  listUsers,
  suspendUser,
  updateUser,
} from "./users";

function jsonResponse(status: number, data: unknown, message = "ok") {
  return new Response(
    JSON.stringify({ success: status < 300, message, data, errors: status < 300 ? [] : [`ERROR: ${message}`], traceId: "t", timestamp: "now" }),
    { status },
  );
}

describe("users API module", () => {
  beforeEach(() => {
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listUsers sends search/status/pagination as query params and unwraps the paginated envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listUsers({ search: "jane", status: "ACTIVE", page: 2, limit: 10 });

    expect(result.meta.total).toBe(0);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/users");
    expect(url.searchParams.get("search")).toBe("jane");
    expect(url.searchParams.get("status")).toBe("ACTIVE");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("getUser requests the single-user path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getUser("u1");

    expect(fetchMock).toHaveBeenCalledWith("http://test.local/api/v1/users/u1", expect.objectContaining({ method: "GET" }));
  });

  it("createUser posts the CreateUserDto shape, organizationId included", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createUser({ email: "a@b.com", organizationId: "org-1", firstName: "A", lastName: "B" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://test.local/api/v1/users");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.com", organizationId: "org-1", firstName: "A", lastName: "B" });
  });

  it("createUser surfaces IAM_EMAIL_ALREADY_REGISTERED as a real 409 ApiError, not a silent success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, null, "An account for 'a@b.com' already exists")));

    await expect(createUser({ email: "a@b.com", organizationId: "org-1", firstName: "A", lastName: "B" })).rejects.toMatchObject({
      status: 409,
      message: "An account for 'a@b.com' already exists",
    });
  });

  it("updateUser PATCHes only the provided fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);

    await updateUser("u1", { firstName: "New" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://test.local/api/v1/users/u1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ firstName: "New" });
  });

  it.each([
    ["activateUser", activateUser, "activate"],
    ["suspendUser", suspendUser, "suspend"],
    ["deactivateUser", deactivateUser, "deactivate"],
  ] as const)("%s POSTs to the correct lifecycle sub-path", async (_name, fn, segment) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "u1" }));
    vi.stubGlobal("fetch", fetchMock);

    await fn("u1");

    expect(fetchMock).toHaveBeenCalledWith(`http://test.local/api/v1/users/u1/${segment}`, expect.objectContaining({ method: "POST" }));
  });

  it("a 400 INVALID_USER_TRANSITION rejects with the backend's specific message intact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, null, "Cannot activate a user in status ACTIVE (must be one of: PROVISIONED, SUSPENDED)")),
    );

    await expect(activateUser("u1")).rejects.toMatchObject({
      status: 400,
      message: "Cannot activate a user in status ACTIVE (must be one of: PROVISIONED, SUSPENDED)",
    });
  });

  it("deleteUser sends DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, null));
    vi.stubGlobal("fetch", fetchMock);

    await deleteUser("u1");

    expect(fetchMock).toHaveBeenCalledWith("http://test.local/api/v1/users/u1", expect.objectContaining({ method: "DELETE" }));
  });

  it("a 403 from PermissionsGuard rejects as isForbidden, not a generic error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, null, "Insufficient permissions to access this resource")));

    const error = await listUsers().catch((e) => e);
    expect(error.isForbidden).toBe(true);
  });
});
