import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureApiClient } from "./client";
import { listLoginAttempts, listSecurityEvents } from "./security-audit";

function jsonResponse(status: number, data: unknown, message = "ok") {
  return new Response(
    JSON.stringify({ success: status < 300, message, data, errors: status < 300 ? [] : [`ERROR: ${message}`], traceId: "t", timestamp: "now" }),
    { status },
  );
}

describe("security-audit API module", () => {
  beforeEach(() => {
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listSecurityEvents requests the events path with eventType/actorUserId as exact-match query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await listSecurityEvents({ eventType: "iam.role_granted", actorUserId: "u1", page: 1, limit: 25 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/security-audit/events");
    expect(url.searchParams.get("eventType")).toBe("iam.role_granted");
    expect(url.searchParams.get("actorUserId")).toBe("u1");
  });

  it("a 403 from SECURITY_AUDIT_VIEW rejects as isForbidden", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, null, "Insufficient permissions to access this resource")));

    const error = await listSecurityEvents().catch((e) => e);
    expect(error.isForbidden).toBe(true);
  });

  it("listLoginAttempts sends identifier/success/pagination as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await listLoginAttempts({ identifier: "jane@acme.com", success: "false" });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/security-audit/login-attempts");
    expect(url.searchParams.get("identifier")).toBe("jane@acme.com");
    expect(url.searchParams.get("success")).toBe("false");
  });

  it("listLoginAttempts with no filters omits them from the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await listLoginAttempts({ page: 1, limit: 25 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.has("identifier")).toBe(false);
    expect(url.searchParams.has("success")).toBe(false);
    expect(url.searchParams.has("userId")).toBe(false);
  });
});
