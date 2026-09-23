import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth, type LoginCredentials } from "@/app/providers/AuthProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { PermissionProvider } from "@/app/providers/PermissionProvider";
import { TenantProvider } from "@/app/providers/TenantProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { getCurrentUser, login } from "@/shared/api";
import { PERMISSIONS } from "@/shared/auth/permissions";

import DashboardPage from "./DashboardPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

const TEST_CREDENTIALS: LoginCredentials = { tenantCode: "DEFAULT", email: "dev@test.local", password: "irrelevant" };

function LoginTrigger() {
  const { login: doLogin } = useAuth();
  useEffect(() => {
    doLogin(TEST_CREDENTIALS).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);
  return null;
}

function renderPage(permissions: string[], fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.mocked(getCurrentUser).mockResolvedValue({
    user: { id: "test-user-id", email: "dev@test.local", username: null, firstName: "Dev", lastName: "User", status: "ACTIVE" },
    tenant: { id: "test-tenant-id", tenantCode: "DEFAULT", tenantName: "Default Tenant" },
    organizationContext: { organizationId: null, organizationName: null },
    roles: [{ id: "test-role-id", roleCode: "TENANT_ADMIN", roleName: "Tenant Administrator" }],
    permissions,
    session: { id: "test-session-id", expiresAt: "2999-01-01T00:00:00.000Z" },
  });

  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <AuthProvider>
            <TenantProvider>
              <PermissionProvider>
                <MemoryRouter initialEntries={["/dashboard"]}>
                  <LoginTrigger />
                  <Routes>
                    <Route path="/login" element={<div>Login page</div>} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/users" element={<div>Users page</div>} />
                    <Route path="/memberships" element={<div>Memberships page</div>} />
                  </Routes>
                </MemoryRouter>
              </PermissionProvider>
            </TenantProvider>
          </AuthProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
  return fetchMock;
}

function standardFetch() {
  return async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/users") return jsonResponse(200, { items: [], meta: { page: 1, limit: 1, total: 42, totalPages: 42 } });
    if (pathname === "/api/v1/organizations") return jsonResponse(200, { items: [], meta: { page: 1, limit: 1, total: 5, totalPages: 5 } });
    if (pathname === "/api/v1/memberships" && searchParams.get("status") === "ACTIVE") {
      return jsonResponse(200, { items: [], meta: { page: 1, limit: 1, total: 40, totalPages: 40 } });
    }
    if (pathname === "/api/v1/memberships" && searchParams.get("status") === "INVITED") {
      return jsonResponse(200, { items: [], meta: { page: 1, limit: 1, total: 2, totalPages: 2 } });
    }
    if (pathname === "/api/v1/product-entitlements") {
      return jsonResponse(200, [
        { productId: "p1", productName: "TravelOS", productSlug: "travelos", status: "ACTIVE", eligible: true },
        { productId: "p2", productName: "Banking AI", productSlug: "banking-ai", status: "SUSPENDED", eligible: false },
      ]);
    }
    if (pathname === "/api/v1/security-audit/events") return jsonResponse(200, { items: [], meta: { page: 1, limit: 5, total: 0, totalPages: 0 } });
    if (pathname === "/api/v1/security-audit/login-attempts") return jsonResponse(200, { items: [], meta: { page: 1, limit: 5, total: 0, totalPages: 0 } });
    throw new Error(`Unexpected fetch in test: ${url} ${init?.method ?? "GET"}`);
  };
}

describe("DashboardPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(login).mockClear();
    vi.mocked(getCurrentUser).mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("shows real KPI numbers from real endpoints — never fabricated counts", async () => {
    renderPage([PERMISSIONS.USER_VIEW, PERMISSIONS.ORGANIZATION_MANAGE, PERMISSIONS.SECURITY_AUDIT_VIEW], standardFetch());

    expect(await screen.findByText("42")).toBeInTheDocument(); // Users
    expect(screen.getByText("5")).toBeInTheDocument(); // Organizations
    expect(screen.getByText("40")).toBeInTheDocument(); // Active memberships
    expect(screen.getByText("2")).toBeInTheDocument(); // Pending invitations
    expect(screen.getByText("1")).toBeInTheDocument(); // Products enabled — only the ACTIVE one counts
  });

  it("hides a tile entirely when the caller lacks its permission, rather than showing a 403 or a zero", async () => {
    renderPage([], standardFetch());

    // Products enabled is always visible (self-service, no permission gate).
    expect(await screen.findByText("Products enabled")).toBeInTheDocument();
    expect(screen.queryByText("Organizations")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent security events")).not.toBeInTheDocument();
  });

  it("shows recent security events and login attempts, each with a link to the full history", async () => {
    renderPage([PERMISSIONS.SECURITY_AUDIT_VIEW], async (url, init) => {
      const { pathname } = new URL(url);
      if (pathname === "/api/v1/product-entitlements") return jsonResponse(200, []);
      if (pathname === "/api/v1/security-audit/events") {
        return jsonResponse(200, {
          items: [{ id: "evt-1", tenantId: "test-tenant-id", actorUserId: null, scope: "TENANT", eventType: "auth.login_succeeded", createdAt: "2026-01-01T00:00:00.000Z" }],
          meta: { page: 1, limit: 5, total: 1, totalPages: 1 },
        });
      }
      if (pathname === "/api/v1/security-audit/login-attempts") return jsonResponse(200, { items: [], meta: { page: 1, limit: 5, total: 0, totalPages: 0 } });
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    expect(await screen.findByText("No recent login attempts")).toBeInTheDocument();
    expect(screen.getAllByText("View all security events").length).toBeGreaterThan(0);
  });
});
