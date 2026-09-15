import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

import { PlatformAuthProvider, usePlatformAuth } from "../providers/PlatformAuthProvider";
import { PlatformPermissionRoute, PlatformProtectedRoute } from "./PlatformRouteGuards";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

/** Mirrors PlatformLoginPage's own real behavior: navigate to the protected route only after login actually succeeds. */
function LoginTrigger({ credentials, redirectTo }: { credentials: { email: string; password: string }; redirectTo: string }) {
  const { login } = usePlatformAuth();
  const navigate = useNavigate();
  return (
    <button
      onClick={() => {
        login(credentials)
          .then(() => navigate(redirectTo, { replace: true }))
          .catch(() => {});
      }}
    >
      trigger-login
    </button>
  );
}

function renderTree(fetchImpl: (url: string) => Promise<Response>, initialEntry = "/platform-console/tenants") {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(fetchImpl));
  return render(
    <PlatformAuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LoginTrigger credentials={{ email: "operator@example.com", password: "secret" }} redirectTo="/platform-console/tenants" />
        <Routes>
          <Route path="/platform-console/login" element={<div>Platform login page</div>} />
          <Route path="/platform-console/403" element={<div>Platform 403 page</div>} />
          <Route element={<PlatformProtectedRoute />}>
            <Route
              path="/platform-console/tenants"
              element={
                <PlatformPermissionRoute permission="PLATFORM_TENANT_VIEW">
                  <div>Tenant registry page</div>
                </PlatformPermissionRoute>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </PlatformAuthProvider>,
  );
}

describe("Platform route guards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("redirects an unauthenticated visitor to the platform login page, never the tenant one", async () => {
    renderTree(async () => jsonResponse(200, null));
    expect(await screen.findByText("Platform login page")).toBeInTheDocument();
  });

  it("redirects to the platform 403 page when the operator lacks the required permission — never renders the protected content", async () => {
    const user = userEvent.setup();
    renderTree(async (url) => {
      if (url.endsWith("/platform/auth/login")) return jsonResponse(200, { accessToken: "a", refreshToken: "r", tokenType: "Bearer", expiresIn: 900 });
      if (url.endsWith("/platform/auth/me")) return jsonResponse(200, { id: "op-1", email: "operator@example.com", permissionCodes: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await screen.findByText("Platform login page");
    await user.click(screen.getByRole("button", { name: "trigger-login" }));

    expect(await screen.findByText("Platform 403 page")).toBeInTheDocument();
    expect(screen.queryByText("Tenant registry page")).not.toBeInTheDocument();
  });

  it("renders the protected content once authenticated with the required permission", async () => {
    const user = userEvent.setup();
    renderTree(async (url) => {
      if (url.endsWith("/platform/auth/login")) return jsonResponse(200, { accessToken: "a", refreshToken: "r", tokenType: "Bearer", expiresIn: 900 });
      if (url.endsWith("/platform/auth/me")) return jsonResponse(200, { id: "op-1", email: "operator@example.com", permissionCodes: ["PLATFORM_TENANT_VIEW"] });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await screen.findByText("Platform login page");
    await user.click(screen.getByRole("button", { name: "trigger-login" }));

    expect(await screen.findByText("Tenant registry page")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Platform 403 page")).not.toBeInTheDocument());
  });
});
