import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BreadcrumbLabelProvider } from "@/app/router/BreadcrumbLabel";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { TestPermissionProvider } from "@/app/providers/PermissionProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { configureApiClient } from "@/shared/api";
import { PERMISSIONS } from "@/shared/auth/permissions";

import UserDetailsPage from "./UserDetailsPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

const USER = {
  id: "user-1",
  email: "ada@example.com",
  username: null,
  firstName: "Ada",
  lastName: "Lovelace",
  status: "ACTIVE",
  emailVerifiedAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderPage(grantedPermissions: string[], fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <ConfirmProvider>
            <TestPermissionProvider grantedPermissions={grantedPermissions}>
              <MemoryRouter initialEntries={["/users/user-1"]}>
                <BreadcrumbLabelProvider>
                  <Routes>
                    <Route path="/users" element={<div>Users list page</div>} />
                    <Route path="/users/:id" element={<UserDetailsPage />} />
                    <Route path="/organizations/:id" element={<div>Organization details page</div>} />
                  </Routes>
                </BreadcrumbLabelProvider>
              </MemoryRouter>
            </TestPermissionProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
  return fetchMock;
}

function standardFetch() {
  return async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/users/user-1" && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, USER);
    }
    if (pathname === "/api/v1/users/user-1/roles") {
      return jsonResponse(200, []);
    }
    if (pathname === "/api/v1/memberships") {
      const searchParams = new URL(url).searchParams;
      expect(searchParams.get("userId")).toBe("user-1");
      return jsonResponse(200, {
        items: [
          {
            id: "membership-1",
            tenantId: "test-tenant-id",
            organizationId: "org-1",
            userId: "user-1",
            status: "ACTIVE",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: null,
            user: { id: "user-1", email: USER.email, firstName: USER.firstName, lastName: USER.lastName, status: USER.status },
            organization: { id: "org-1", organizationName: "Org One" },
          },
        ],
        meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
    }
    throw new Error(`Unexpected fetch in test: ${url} ${init?.method ?? "GET"}`);
  };
}

describe("UserDetailsPage — Memberships tab", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows this user's membership within the CURRENT tenant only — organization, status, and a link, never another tenant's data", async () => {
    const user = userEvent.setup();
    renderPage([PERMISSIONS.USER_VIEW], standardFetch());

    await screen.findByRole("heading", { name: "Ada Lovelace" });
    await user.click(screen.getByRole("tab", { name: "Memberships" }));

    expect(await screen.findByText("Org One")).toBeInTheDocument();
    expect(screen.getByText(/Member since/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View organization" }));
    expect(await screen.findByText("Organization details page")).toBeInTheDocument();
  });

  it("filters the membership query to this user's id — never fetches the tenant's whole membership list unfiltered", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage([PERMISSIONS.USER_VIEW], standardFetch());

    await screen.findByRole("heading", { name: "Ada Lovelace" });
    await user.click(screen.getByRole("tab", { name: "Memberships" }));
    await screen.findByText("Org One");

    const membershipCall = fetchMock.mock.calls.find((c) => new URL(c[0] as string).pathname === "/api/v1/memberships");
    expect(membershipCall).toBeDefined();
    expect(new URL(membershipCall![0] as string).searchParams.get("userId")).toBe("user-1");
  });

  it("shows an empty state, not a blank tab, when the user has no memberships in this tenant", async () => {
    const user = userEvent.setup();
    renderPage([PERMISSIONS.USER_VIEW], async (url, init) => {
      const { pathname } = new URL(url);
      if (pathname === "/api/v1/users/user-1") return jsonResponse(200, USER);
      if (pathname === "/api/v1/users/user-1/roles") return jsonResponse(200, []);
      if (pathname === "/api/v1/memberships") return jsonResponse(200, { items: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } });
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await screen.findByRole("heading", { name: "Ada Lovelace" });
    await user.click(screen.getByRole("tab", { name: "Memberships" }));
    expect(await screen.findByText("No memberships")).toBeInTheDocument();
  });
});
