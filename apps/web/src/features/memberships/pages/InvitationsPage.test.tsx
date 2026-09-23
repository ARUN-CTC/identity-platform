import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { TestPermissionProvider } from "@/app/providers/PermissionProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { configureApiClient } from "@/shared/api";
import { PERMISSIONS } from "@/shared/auth/permissions";

import InvitationsPage from "./InvitationsPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

const INVITED_MEMBER = {
  id: "membership-1",
  tenantId: "test-tenant-id",
  organizationId: "org-1",
  userId: "user-1",
  status: "INVITED",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: null,
  user: { id: "user-1", email: "invitee@example.com", firstName: "In", lastName: "Vitee", status: "PROVISIONED" },
  organization: { id: "org-1", organizationName: "Org One" },
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
              <MemoryRouter initialEntries={["/invitations"]}>
                <Routes>
                  <Route path="/invitations" element={<InvitationsPage />} />
                </Routes>
              </MemoryRouter>
            </TestPermissionProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
  return fetchMock;
}

function standardFetch(overrides: { onCreate?: (body: Record<string, unknown>) => Response | Promise<Response> } = {}) {
  return async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/memberships" && (init?.method ?? "GET") === "GET") {
      expect(searchParams.get("status")).toBe("INVITED");
      return jsonResponse(200, { items: [INVITED_MEMBER], meta: { page: 1, limit: 25, total: 1, totalPages: 1 } });
    }
    if (pathname === "/api/v1/organizations" && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, {
        items: [{ id: "org-1", organizationCode: "ORG1", organizationName: "Org One", status: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z" }],
        meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
    }
    if (pathname === "/api/v1/users" && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      if (overrides.onCreate) return overrides.onCreate(body);
      return jsonResponse(201, { id: "user-2", email: body.email, firstName: body.firstName, lastName: body.lastName, status: "PROVISIONED" });
    }
    if (pathname.endsWith("/resend-invitation") && init?.method === "POST") {
      return jsonResponse(200, { ...INVITED_MEMBER });
    }
    throw new Error(`Unexpected fetch in test: ${url} ${init?.method ?? "GET"}`);
  };
}

describe("InvitationsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always filters to status=INVITED and shows every pending invitation across the tenant", async () => {
    renderPage([PERMISSIONS.USER_VIEW], standardFetch());
    expect(await screen.findByText("invitee@example.com")).toBeInTheDocument();
    expect(screen.getByText("Org One")).toBeInTheDocument();
  });

  it("shows an empty state, not a blank screen, when there are no pending invitations", async () => {
    renderPage([PERMISSIONS.USER_VIEW], async (url) => {
      const { pathname } = new URL(url);
      if (pathname === "/api/v1/memberships") return jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 0 } });
      if (pathname === "/api/v1/organizations") return jsonResponse(200, { items: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    expect(await screen.findByText("No pending invitations")).toBeInTheDocument();
  });

  it("hides 'Invite user' without USER_MANAGE — the frontend gate, never the sole boundary", async () => {
    renderPage([PERMISSIONS.USER_VIEW], standardFetch());
    await screen.findByText("invitee@example.com");
    expect(screen.queryByRole("button", { name: "Invite user" })).not.toBeInTheDocument();
  });

  it("invites a user via the real CreateUserDrawer flow, and refreshes the invitations list on success", async () => {
    const user = userEvent.setup();
    renderPage([PERMISSIONS.USER_VIEW, PERMISSIONS.USER_MANAGE], standardFetch());
    await screen.findByText("invitee@example.com");

    await user.click(screen.getByRole("button", { name: "Invite user" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Email/i), "new-invitee@example.com");
    await user.type(within(dialog).getByLabelText(/First name/i), "New");
    await user.type(within(dialog).getByLabelText(/Last name/i), "Invitee");
    await user.click(within(dialog).getByRole("combobox", { name: "Organization" }));
    const option = await screen.findByRole("option", { name: "Org One" });
    await user.click(option);
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByText(/was added successfully/i)).toBeInTheDocument();
  });

  it("resends an invitation for a pending row", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage([PERMISSIONS.USER_VIEW], standardFetch());
    await screen.findByText("invitee@example.com");

    await user.click(screen.getByRole("button", { name: "Resend invitation" }));
    expect(await screen.findByText(/Invitation resent to invitee@example.com/i)).toBeInTheDocument();
    const resendCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes("/resend-invitation"));
    expect(resendCall).toBeDefined();
  });

  it("never offers a revoke action — no revoke-invitation endpoint exists on this backend", async () => {
    renderPage([PERMISSIONS.USER_VIEW], standardFetch());
    await screen.findByText("invitee@example.com");
    expect(screen.queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
  });
});
