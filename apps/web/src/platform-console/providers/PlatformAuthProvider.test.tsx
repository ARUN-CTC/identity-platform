import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformAuthProvider, usePlatformAuth } from "./PlatformAuthProvider";

function jsonResponse(status: number, data: unknown, message = "ok") {
  return new Response(
    JSON.stringify({ success: status < 300, message, data, errors: status < 300 ? [] : [`ERROR: ${message}`], traceId: "t", timestamp: "now" }),
    { status },
  );
}

function Probe() {
  const { isAuthenticated, isLoading, operator, hasPlatformPermission, login } = usePlatformAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="email">{operator?.email ?? ""}</span>
      <span data-testid="has-tenant-view">{String(hasPlatformPermission("PLATFORM_TENANT_VIEW"))}</span>
      <button
        onClick={() => {
          login({ email: "operator@example.com", password: "secret" }).catch(() => {
            // Real callers (PlatformLoginPage) catch this to show a form
            // error — this probe just needs the attempt to not crash the test.
          });
        }}
      >
        Sign in
      </button>
    </div>
  );
}

describe("PlatformAuthProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("starts unauthenticated with no persisted session, never calling the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PlatformAuthProvider>
        <Probe />
      </PlatformAuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("authed").textContent).toBe("false");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs in, exposes the operator's own permission codes, and never sends tenant headers", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/platform/auth/login")) {
        return jsonResponse(200, { accessToken: "plat-access", refreshToken: "plat-refresh", tokenType: "Bearer", expiresIn: 900 });
      }
      if (url.endsWith("/platform/auth/me")) {
        return jsonResponse(200, { id: "op-1", email: "operator@example.com", permissionCodes: ["PLATFORM_TENANT_VIEW"] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <PlatformAuthProvider>
        <Probe />
      </PlatformAuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByTestId("authed").textContent).toBe("true"));
    expect(screen.getByTestId("email").textContent).toBe("operator@example.com");
    expect(screen.getByTestId("has-tenant-view").textContent).toBe("true");

    // Every call this provider made carries only an Authorization header —
    // never X-Tenant-Id/X-User-Id/X-Organization-Id (a Platform Operator
    // has no tenant context at all).
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers["X-Tenant-Id"]).toBeUndefined();
      expect(headers["X-Organization-Id"]).toBeUndefined();
    }
  });

  it("surfaces the backend's own generic invalid-credentials error on failed login", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/platform/auth/login")) return jsonResponse(401, null, "Invalid credentials");
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <PlatformAuthProvider>
        <Probe />
      </PlatformAuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("authed").textContent).toBe("false"));
  });
});
