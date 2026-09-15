import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureApiClient } from "./client";
import {
  createRole,
  deleteRole,
  getRole,
  grantRolePermission,
  listRolePermissions,
  listRoles,
  revokeRolePermission,
  updateRole,
} from "./roles";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

describe("roles API module", () => {
  beforeEach(() => {
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listRoles sends search/includeSystem/pagination as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await listRoles({ search: "admin", includeSystem: false, page: 1, limit: 25 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("search")).toBe("admin");
    expect(url.searchParams.get("includeSystem")).toBe("false");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("getRole requests the single-role path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "r1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getRole("r1");

    expect(fetchMock).toHaveBeenCalledWith("http://test.local/api/v1/roles/r1", expect.objectContaining({ method: "GET" }));
  });

  // security_role uses apply_tenant_rls_nullable() — a role from another
  // tenant (and not a system role) is invisible, not a distinguishing 403.
  it("a cross-tenant or nonexistent role rejects as a plain 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, null, "Role 'r-x' not found")));

    const error = await getRole("r-x").catch((e) => e);
    expect(error.isNotFound).toBe(true);
  });

  it("createRole posts the CreateRoleDto shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "r1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createRole({ roleCode: "BILLING_MANAGER", roleName: "Billing Manager" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://test.local/api/v1/roles");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ roleCode: "BILLING_MANAGER", roleName: "Billing Manager" });
  });

  it("updateRole on a system role rejects with SYSTEM_ROLE_IMMUTABLE (400), never a silent success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, null, "'TENANT_ADMIN' is a system role and cannot be modified through this API")),
    );

    await expect(updateRole("r1", { roleName: "New name" })).rejects.toMatchObject({ status: 400 });
  });

  it("deleteRole on a role still assigned to users rejects with a real 409, not a silent success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, null, "'BILLING_MANAGER' is currently assigned to 3 users and cannot be deleted")),
    );

    await expect(deleteRole("r1")).rejects.toMatchObject({ status: 409 });
  });

  it("listRolePermissions requests the role-scoped permissions path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchMock);

    await listRolePermissions("r1");

    expect(fetchMock).toHaveBeenCalledWith("http://test.local/api/v1/roles/r1/permissions", expect.objectContaining({ method: "GET" }));
  });

  it("grantRolePermission posts permissionId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "rp1" }));
    vi.stubGlobal("fetch", fetchMock);

    await grantRolePermission("r1", "p1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://test.local/api/v1/roles/r1/permissions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ permissionId: "p1" });
  });

  // ROLE-SECURITY-001 — granting a permission the caller doesn't hold
  // themselves (and doesn't have TENANT_MANAGE to bypass with) is a real,
  // backend-enforced 403, never a frontend-only approximation.
  it("grantRolePermission rejects with INSUFFICIENT_PRIVILEGE_TO_GRANT (403) when the caller lacks the permission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(403, null, "Cannot grant 'USER_MANAGE' — you do not hold this permission yourself")),
    );

    const error = await grantRolePermission("r1", "p1").catch((e) => e);
    expect(error.isForbidden).toBe(true);
    expect(error.message).toBe("Cannot grant 'USER_MANAGE' — you do not hold this permission yourself");
  });

  it("revokeRolePermission sends DELETE to the permission-scoped path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, null));
    vi.stubGlobal("fetch", fetchMock);

    await revokeRolePermission("r1", "p1");

    expect(fetchMock).toHaveBeenCalledWith("http://test.local/api/v1/roles/r1/permissions/p1", expect.objectContaining({ method: "DELETE" }));
  });
});
