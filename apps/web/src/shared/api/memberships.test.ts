import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureApiClient } from "./client";
import { listMembers, updateMembershipStatus } from "./memberships";

function jsonResponse(status: number, data: unknown, message = "ok") {
  return new Response(
    JSON.stringify({ success: status < 300, message, data, errors: status < 300 ? [] : [`ERROR: ${message}`], traceId: "t", timestamp: "now" }),
    { status },
  );
}

describe("memberships API module", () => {
  beforeEach(() => {
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listMembers requests the organization-scoped path — membership is organization-centric, there is no user-scoped equivalent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await listMembers("org-1", { page: 1, limit: 20 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/organizations/org-1/members");
  });

  it("listMembers surfaces a 404 for a cross-tenant or nonexistent organization id (the endpoint 404s the organization itself first)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, null, "Organization 'org-x' not found")));

    const error = await listMembers("org-x").catch((e) => e);
    expect(error.isNotFound).toBe(true);
  });

  it("updateMembershipStatus PATCHes the member's status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "m-1", status: "SUSPENDED" }));
    vi.stubGlobal("fetch", fetchMock);

    await updateMembershipStatus("org-1", "user-1", "SUSPENDED");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://test.local/api/v1/organizations/org-1/members/user-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "SUSPENDED" });
  });

  it("updateMembershipStatus on a nonexistent membership rejects with MEMBERSHIP_NOT_FOUND (404), not a silent success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(404, null, "No membership found for this user in organization org-1")),
    );

    await expect(updateMembershipStatus("org-1", "user-x", "REMOVED")).rejects.toMatchObject({ status: 404 });
  });
});
