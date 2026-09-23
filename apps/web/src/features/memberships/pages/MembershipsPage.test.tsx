import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth, type LoginCredentials } from "@/app/providers/AuthProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { TenantProvider } from "@/app/providers/TenantProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { getCurrentUser, login } from "@/shared/api";

import MembershipsPage from "./MembershipsPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

const ACTIVE_MEMBER = {
  id: "membership-1",
  tenantId: "test-tenant-id",
  organizationId: "org-1",
  userId: "other-user-id",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: null,
  user: { id: "other-user-id", email: "member@example.com", firstName: "Mem", lastName: "Ber", status: "ACTIVE" },
  organization: { id: "org-1", organizationName: "Org One" },
};

const TEST_CREDENTIALS: LoginCredentials = { tenantCode: "DEFAULT", email: "dev@test.local", password: "irrelevant" };

function LoginTrigger() {
  const { login: doLogin } = useAuth();
  useEffect(() => {
    doLogin(TEST_CREDENTIALS).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);
  return null;
}

function renderPage(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <ConfirmProvider>
            <AuthProvider>
              <TenantProvider>
                <MemoryRouter initialEntries={["/memberships"]}>
                  <LoginTrigger />
                  <Routes>
                    <Route path="/login" element={<div>Login page</div>} />
                    <Route path="/memberships" element={<MembershipsPage />} />
                    <Route path="/users/:id" element={<div>User details page</div>} />
                  </Routes>
                </MemoryRouter>
              </TenantProvider>
            </AuthProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
  return fetchMock;
}

function standardFetch(overrides: { onStatusChange?: (body: Record<string, unknown>) => Response | Promise<Response> } = {}) {
  return async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/memberships" && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, { items: [ACTIVE_MEMBER], meta: { page: 1, limit: 25, total: 1, totalPages: 1 } });
    }
    if (pathname === "/api/v1/organizations" && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, {
        items: [{ id: "org-1", organizationCode: "ORG1", organizationName: "Org One", status: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z" }],
        meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
    }
    if (pathname === "/api/v1/organizations/org-1/members/other-user-id" && init?.method === "PATCH") {
      const body = JSON.parse(init.body as string);
      if (overrides.onStatusChange) return overrides.onStatusChange(body);
      return jsonResponse(200, { ...ACTIVE_MEMBER, status: body.status });
    }
    throw new Error(`Unexpected fetch in test: ${url} ${init?.method ?? "GET"}`);
  };
}

describe("MembershipsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(login).mockClear();
    vi.mocked(getCurrentUser).mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("lists memberships spanning every organization in the tenant", async () => {
    renderPage(standardFetch());
    expect(await screen.findByText("member@example.com")).toBeInTheDocument();
    expect(screen.getByText("Org One")).toBeInTheDocument();
  });

  it("shows an empty state, not a blank screen, when there are no memberships", async () => {
    renderPage(async (url) => {
      const { pathname } = new URL(url);
      if (pathname === "/api/v1/memberships") return jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 0 } });
      if (pathname === "/api/v1/organizations") return jsonResponse(200, { items: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    expect(await screen.findByText("No memberships yet")).toBeInTheDocument();
  });

  it("changing a membership's status requires confirmation, and sends it to that row's own organization", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(standardFetch());
    await screen.findByText("member@example.com");

    await user.click(screen.getByRole("button", { name: /Change status/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Suspend" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/immediately/i);
    await user.click(screen.getByRole("button", { name: "Suspend" }));

    expect(await screen.findByText(/is now suspended/i)).toBeInTheDocument();
    const patchCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect((patchCall![0] as string)).toContain("/organizations/org-1/members/other-user-id");
  });

  it("cancelling the confirmation makes no request", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(standardFetch());
    await screen.findByText("member@example.com");

    await user.click(screen.getByRole("button", { name: /Change status/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    const patchCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patchCalls).toHaveLength(0);
  });

  it("filters by organization", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(standardFetch());
    await screen.findByText("member@example.com");
    fetchMock.mockClear();

    const combobox = await screen.findByText("All organizations");
    await user.click(combobox);
    const option = await screen.findByRole("option", { name: "Org One" });
    await user.click(option);

    const listCall = fetchMock.mock.calls.find((c) => new URL(c[0] as string).pathname === "/api/v1/memberships");
    expect(listCall).toBeDefined();
    expect(new URL(listCall![0] as string).searchParams.get("organizationId")).toBe("org-1");
  });
});
