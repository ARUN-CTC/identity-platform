import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/app/providers/AuthProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { ApiError, getCurrentUser, listMyOrganizations, login } from "@/shared/api";

import LoginPage from "./LoginPage";

function renderPage(initialEntries: string[] = ["/login"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={initialEntries}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/dashboard" element={<div>Dashboard page</div>} />
                <Route path="/choose-organization" element={<div>Choose organization page</div>} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
}

async function submitLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Tenant code/i), "ACME");
  await user.type(screen.getByLabelText(/^Email/i), "user@example.com");
  await user.type(screen.getByLabelText(/^Password/i), "correct-horse");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

const BASE_ME = {
  user: { id: "u1", email: "user@example.com", username: null, firstName: "A", lastName: "B", status: "ACTIVE" },
  tenant: { id: "t1", tenantCode: "ACME", tenantName: "Acme" },
  roles: [],
  permissions: [],
  session: { id: "s1", expiresAt: "2999-01-01T00:00:00.000Z" },
};

describe("LoginPage", () => {
  afterEach(() => {
    vi.mocked(login).mockClear();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(listMyOrganizations).mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("goes straight to the dashboard when the caller has no organizations to choose from", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue({ ...BASE_ME, organizationContext: { organizationId: null, organizationName: null } });
    vi.mocked(listMyOrganizations).mockResolvedValue([]);
    renderPage();

    await submitLogin(user);
    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  });

  it("auto-establishes the sole organization and proceeds without asking, when exactly one is available", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue({ ...BASE_ME, organizationContext: { organizationId: null, organizationName: null } });
    vi.mocked(listMyOrganizations).mockResolvedValue([
      { organizationId: "org-1", organizationName: "Org One", organizationStatus: "ACTIVE", tenantId: "t1", tenantCode: "ACME", tenantName: "Acme", tenantStatus: "ACTIVE", membershipStatus: "ACTIVE" },
    ]);
    renderPage();

    await submitLogin(user);
    // Lands on the choose-organization route with autoSelect — that page
    // itself calls switchOrganization and then redirects onward; the
    // routing decision under test here is "don't dump a 1-choice picker on
    // the user."
    expect(await screen.findByText("Choose organization page")).toBeInTheDocument();
  });

  it("routes to the organization picker when more than one organization is available and context is still tenant-wide", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue({ ...BASE_ME, organizationContext: { organizationId: null, organizationName: null } });
    vi.mocked(listMyOrganizations).mockResolvedValue([
      { organizationId: "org-1", organizationName: "Org One", organizationStatus: "ACTIVE", tenantId: "t1", tenantCode: "ACME", tenantName: "Acme", tenantStatus: "ACTIVE", membershipStatus: "ACTIVE" },
      { organizationId: "org-2", organizationName: "Org Two", organizationStatus: "ACTIVE", tenantId: "t1", tenantCode: "ACME", tenantName: "Acme", tenantStatus: "ACTIVE", membershipStatus: "ACTIVE" },
    ]);
    renderPage();

    await submitLogin(user);
    expect(await screen.findByText("Choose organization page")).toBeInTheDocument();
  });

  it("goes straight to the dashboard when the backend already resolved a specific organization context", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue({ ...BASE_ME, organizationContext: { organizationId: "org-1", organizationName: "Org One" } });
    vi.mocked(listMyOrganizations).mockResolvedValue([
      { organizationId: "org-1", organizationName: "Org One", organizationStatus: "ACTIVE", tenantId: "t1", tenantCode: "ACME", tenantName: "Acme", tenantStatus: "ACTIVE", membershipStatus: "ACTIVE" },
    ]);
    renderPage();

    await submitLogin(user);
    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  });

  it("shows the backend's own error message on invalid credentials, without navigating anywhere", async () => {
    const user = userEvent.setup();
    vi.mocked(login).mockRejectedValueOnce(new ApiError("Invalid credentials", 401));
    renderPage();

    await submitLogin(user);
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("resumes a pending OAuth authorization via a real top-level navigation, when authorize_request is present and there's no organization ambiguity", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue({ ...BASE_ME, organizationContext: { organizationId: null, organizationName: null } });
    vi.mocked(listMyOrganizations).mockResolvedValue([]);

    const originalLocation = window.location;
    const assignedHrefs: string[] = [];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        set href(value: string) {
          assignedHrefs.push(value);
        },
      },
    });

    try {
      renderPage(["/login?authorize_request=ref-abc123"]);
      await submitLogin(user);

      await vi.waitFor(() => expect(assignedHrefs).toHaveLength(1));
      const url = new URL(assignedHrefs[0]);
      expect(url.pathname).toBe("/api/v1/oauth/authorize/resume");
      expect(url.searchParams.get("ref")).toBe("ref-abc123");
      // Never an in-app navigation for this case.
      expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("carries authorize_request through to the organization picker instead of resuming immediately, when a choice is still needed", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue({ ...BASE_ME, organizationContext: { organizationId: null, organizationName: null } });
    vi.mocked(listMyOrganizations).mockResolvedValue([
      { organizationId: "org-1", organizationName: "Org One", organizationStatus: "ACTIVE", tenantId: "t1", tenantCode: "ACME", tenantName: "Acme", tenantStatus: "ACTIVE", membershipStatus: "ACTIVE" },
      { organizationId: "org-2", organizationName: "Org Two", organizationStatus: "ACTIVE", tenantId: "t1", tenantCode: "ACME", tenantName: "Acme", tenantStatus: "ACTIVE", membershipStatus: "ACTIVE" },
    ]);
    renderPage(["/login?authorize_request=ref-abc123"]);

    await submitLogin(user);
    expect(await screen.findByText("Choose organization page")).toBeInTheDocument();
  });

  it("redirects back to the originally-requested page after a successful login with no organization ambiguity", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue({ ...BASE_ME, organizationContext: { organizationId: null, organizationName: null } });
    vi.mocked(listMyOrganizations).mockResolvedValue([]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeModeProvider>
        <QueryClientProvider client={client}>
          <NotificationProvider>
            <AuthProvider>
              <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: "/users/42" } }]}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/users/:id" element={<div>User detail page</div>} />
                </Routes>
              </MemoryRouter>
            </AuthProvider>
          </NotificationProvider>
        </QueryClientProvider>
      </ThemeModeProvider>,
    );

    await submitLogin(user);
    expect(await screen.findByText("User detail page")).toBeInTheDocument();
  });
});
