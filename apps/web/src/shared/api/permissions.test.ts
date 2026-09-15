import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureApiClient } from "./client";
import { createPermission, deletePermission, listPermissions, updatePermission } from "./permissions";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

describe("permissions API module", () => {
  beforeEach(() => {
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listPermissions sends resource/search/pagination as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await listPermissions({ resource: "USER", search: "VIEW" });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("resource")).toBe("USER");
    expect(url.searchParams.get("search")).toBe("VIEW");
  });

  it("createPermission posts the CreatePermissionDto shape — no platformOnly field exists to set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "p1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createPermission({ permissionCode: "REPORT_VIEW", resource: "REPORT", action: "VIEW" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://test.local/api/v1/permissions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ permissionCode: "REPORT_VIEW", resource: "REPORT", action: "VIEW" });
    expect(body).not.toHaveProperty("platformOnly");
  });

  it("updatePermission only ever sends description — the only field UpdatePermissionDto accepts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "p1" }));
    vi.stubGlobal("fetch", fetchMock);

    await updatePermission("p1", { description: "New description" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ description: "New description" });
  });

  it("deletePermission on a permission still granted to a role rejects with a real 409, not a silent success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, null, "'USER_VIEW' is currently granted to 2 roles and cannot be deleted")),
    );

    await expect(deletePermission("p1")).rejects.toMatchObject({ status: 409 });
  });

  it("a 403 from PERMISSION_VIEW rejects as isForbidden", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, null, "Insufficient permissions to access this resource")));

    const error = await listPermissions().catch((e) => e);
    expect(error.isForbidden).toBe(true);
  });
});
