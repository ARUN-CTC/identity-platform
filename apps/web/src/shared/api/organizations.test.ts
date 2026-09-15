import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureApiClient } from "./client";
import { createOrganization, deleteOrganization, getOrganization, listOrganizations, updateOrganization } from "./organizations";

function jsonResponse(status: number, data: unknown, message = "ok") {
  return new Response(
    JSON.stringify({ success: status < 300, message, data, errors: status < 300 ? [] : [`ERROR: ${message}`], traceId: "t", timestamp: "now" }),
    { status },
  );
}

describe("organizations API module", () => {
  beforeEach(() => {
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listOrganizations sends only pagination params — the backend accepts no search/filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await listOrganizations({ page: 2, limit: 10 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/organizations");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("getOrganization requests the single-organization path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "org-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getOrganization("org-1");

    expect(fetchMock).toHaveBeenCalledWith("http://test.local/api/v1/organizations/org-1", expect.objectContaining({ method: "GET" }));
  });

  // organization has RLS scoped to the caller's own tenant
  // (OrganizationsRepository.findById includes `tenantId` in its WHERE) —
  // a cross-tenant id looks identical to a nonexistent one: a plain 404,
  // never a 403 that would confirm the id exists in another tenant.
  it("a cross-tenant or nonexistent organization id rejects as a plain 404, not 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, null, "Organization 'org-x' not found")));

    const error = await getOrganization("org-x").catch((e) => e);
    expect(error.isNotFound).toBe(true);
    expect(error.isForbidden).toBe(false);
  });

  it("createOrganization posts the CreateOrganizationDto shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "org-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createOrganization({ organizationTypeId: "type-1", organizationCode: "ACME", organizationName: "Acme Corp" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://test.local/api/v1/organizations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ organizationTypeId: "type-1", organizationCode: "ACME", organizationName: "Acme Corp" });
  });

  it("a duplicate organizationCode rejects as a real 409, not a silent success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, null, "A record with the same organization_code already exists")));

    await expect(
      createOrganization({ organizationTypeId: "type-1", organizationCode: "ACME", organizationName: "Acme Corp" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("updateOrganization PATCHes only the provided fields, including status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "org-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await updateOrganization("org-1", { status: "INACTIVE" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://test.local/api/v1/organizations/org-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "INACTIVE" });
  });

  it("deleteOrganization sends DELETE and succeeds even when members still exist — the backend has no such guard", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, null));
    vi.stubGlobal("fetch", fetchMock);

    await deleteOrganization("org-1");

    expect(fetchMock).toHaveBeenCalledWith("http://test.local/api/v1/organizations/org-1", expect.objectContaining({ method: "DELETE" }));
  });

  it("a 403 from PermissionsGuard rejects as isForbidden", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, null, "Insufficient permissions to access this resource")));

    const error = await listOrganizations().catch((e) => e);
    expect(error.isForbidden).toBe(true);
  });
});
