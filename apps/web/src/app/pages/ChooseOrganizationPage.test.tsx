import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth, type LoginCredentials } from "@/app/providers/AuthProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { configureApiClient, getCurrentUser, listMyOrganizations } from "@/shared/api";

import ChooseOrganizationPage from "./ChooseOrganizationPage";

const TEST_CREDENTIALS: LoginCredentials = { tenantCode: "ACME", email: "user@example.com", password: "irrelevant" };
const ORGS = [
  { organizationId: "org-1", organizationName: "Org One", organizationStatus: "ACTIVE", tenantId: "t1", tenantCode: "ACME", tenantName: "Acme", tenantStatus: "ACTIVE", membershipStatus: "ACTIVE" },
  { organizationId: "org-2", organizationName: "Org Two", organizationStatus: "ACTIVE", tenantId: "t1", tenantCode: "ACME", tenantName: "Acme", tenantStatus: "ACTIVE", membershipStatus: "ACTIVE" },
];

/** Drives a real login so AuthProvider's availableOrganizations is populated before the page under test reads it — mirrors the pattern already established in other AuthProvider-backed test files (see e.g. TenantSettingsPage.test.tsx). */
function LoginTrigger({ navigateTo }: { navigateTo?: { path: string; state?: unknown } }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    login(TEST_CREDENTIALS)
      .then(() => {
        if (navigateTo) navigate(navigateTo.path, { state: navigateTo.state });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);
  return null;
}

function jsonResponse(status: number, data: unknown, message = "ok") {
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

const FAKE_TOKENS = { accessToken: "fake-access-token", refreshToken: "fake-refresh-token", tokenType: "Bearer", expiresIn: 900 };

function renderPage(navState?: Record<string, unknown>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      const { pathname } = new URL(url);
      if (pathname === "/api/v1/auth/context/switch" || pathname === "/api/v1/auth/context/clear") {
        return jsonResponse(200, FAKE_TOKENS);
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={["/login"]}>
              <LoginTrigger navigateTo={{ path: "/choose-organization", state: navState }} />
              <Routes>
                <Route path="/login" element={<div>Login page</div>} />
                <Route path="/choose-organization" element={<ChooseOrganizationPage />} />
                <Route path="/dashboard" element={<div>Dashboard page</div>} />
                <Route path="/users/42" element={<div>User detail page</div>} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
}

const BASE_ME = {
  user: { id: "u1", email: "user@example.com", username: null, firstName: "A", lastName: "B", status: "ACTIVE" },
  tenant: { id: "t1", tenantCode: "ACME", tenantName: "Acme" },
  organizationContext: { organizationId: null, organizationName: null },
  roles: [],
  permissions: [],
  session: { id: "s1", expiresAt: "2999-01-01T00:00:00.000Z" },
};

describe("ChooseOrganizationPage", () => {
  afterEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(listMyOrganizations).mockReset();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("lists every organization the caller actually belongs to, and requires a real selection before continuing", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(BASE_ME);
    vi.mocked(listMyOrganizations).mockResolvedValue(ORGS);
    renderPage({ from: "/dashboard" });

    expect(await screen.findByText("Org One")).toBeInTheDocument();
    expect(screen.getByText("Org Two")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("switches to the selected organization and proceeds to the original destination", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue(BASE_ME).mockResolvedValueOnce(BASE_ME).mockResolvedValueOnce({
      ...BASE_ME,
      organizationContext: { organizationId: "org-1", organizationName: "Org One" },
    });
    vi.mocked(listMyOrganizations).mockResolvedValue(ORGS);
    renderPage({ from: "/dashboard" });

    await screen.findByText("Org One");
    await user.click(screen.getByText("Org One"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  });

  it("resumes a pending OAuth authorization via a real top-level navigation instead of an in-app route, once an organization is chosen", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue(BASE_ME).mockResolvedValueOnce(BASE_ME).mockResolvedValueOnce({
      ...BASE_ME,
      organizationContext: { organizationId: "org-1", organizationName: "Org One" },
    });
    vi.mocked(listMyOrganizations).mockResolvedValue(ORGS);

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
      renderPage({ from: "/dashboard", authorizeRequest: "ref-xyz789" });

      await screen.findByText("Org One");
      await user.click(screen.getByText("Org One"));
      await user.click(screen.getByRole("button", { name: "Continue" }));

      await vi.waitFor(() => expect(assignedHrefs).toHaveLength(1));
      const url = new URL(assignedHrefs[0]);
      expect(url.pathname).toBe("/api/v1/oauth/authorize/resume");
      expect(url.searchParams.get("ref")).toBe("ref-xyz789");
      expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("lets the caller stay tenant-wide instead of picking one", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue(BASE_ME);
    vi.mocked(listMyOrganizations).mockResolvedValue(ORGS);
    renderPage({ from: "/users/42" });

    await screen.findByText("Org One");
    await user.click(screen.getByRole("button", { name: "Continue tenant-wide instead" }));

    expect(await screen.findByText("User detail page")).toBeInTheDocument();
  });

  it("surfaces a denied switch (the real backend's own 403) without losing the picker", async () => {
    const user = userEvent.setup();
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        const { pathname } = new URL(url);
        if (pathname === "/api/v1/auth/context/switch") {
          return jsonResponse(403, null, "You do not have access to this organization");
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      }),
    );
    vi.mocked(getCurrentUser).mockResolvedValue(BASE_ME);
    vi.mocked(listMyOrganizations).mockResolvedValue(ORGS);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeModeProvider>
        <QueryClientProvider client={client}>
          <NotificationProvider>
            <AuthProvider>
              <MemoryRouter initialEntries={["/login"]}>
                <LoginTrigger navigateTo={{ path: "/choose-organization", state: { from: "/dashboard" } }} />
                <Routes>
                  <Route path="/login" element={<div>Login page</div>} />
                  <Route path="/choose-organization" element={<ChooseOrganizationPage />} />
                  <Route path="/dashboard" element={<div>Dashboard page</div>} />
                </Routes>
              </MemoryRouter>
            </AuthProvider>
          </NotificationProvider>
        </QueryClientProvider>
      </ThemeModeProvider>,
    );

    await screen.findByText("Org One");
    await user.click(screen.getByText("Org One"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("You do not have access to this organization")).toBeInTheDocument();
    expect(screen.getByText("Org One")).toBeInTheDocument();
  });
});
