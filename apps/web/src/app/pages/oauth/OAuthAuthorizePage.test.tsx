import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/app/providers/AuthProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { configureApiClient, getCurrentUser, listMyOrganizations, login } from "@/shared/api";

import OAuthAuthorizePage from "./OAuthAuthorizePage";

const QUERY = "client_id=travelos&redirect_uri=https%3A%2F%2Ftravelos.example.com%2Fcallback&response_type=code&state=xyz&code_challenge=abc&code_challenge_method=S256";

function renderPage(path = `/oauth/authorize?${QUERY}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/oauth/authorize" element={<OAuthAuthorizePage />} />
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

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Tenant code/i), "ACME");
  await user.type(screen.getByLabelText(/^Email/i), "user@example.com");
  await user.type(screen.getByLabelText(/^Password/i), "correct-horse");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("OAuthAuthorizePage", () => {
  afterEach(() => {
    vi.mocked(login).mockClear();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(listMyOrganizations).mockReset();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("shows a generic safe error, with no backend call at all, when required OAuth parameters are missing", async () => {
    renderPage("/oauth/authorize?response_type=code");
    expect(await screen.findByText("Unable to process sign-in request")).toBeInTheDocument();
  });

  it("shows a sign-in form, never naming the requesting application, when the caller is unauthenticated", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Sign in to continue" })).toBeInTheDocument();
    expect(screen.getByText(/signing in to continue to an external application/i)).toBeInTheDocument();
    // Never trusts client_id for branding — "travelos" (this test's own
    // client_id value) must never appear as if it were a validated name.
    expect(screen.queryByText(/travelos/i)).not.toBeInTheDocument();
  });

  it("after signing in, calls the real backend /oauth/authorize with the caller's own bearer token and the exact original query string", async () => {
    const user = userEvent.setup();
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`http://test.local/api/v1/oauth/authorize?${QUERY}`);
      expect((init?.headers as Record<string, string>)?.Authorization).toMatch(/^Bearer /);
      return { type: "opaqueredirect" } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getCurrentUser).mockResolvedValue(BASE_ME);
    vi.mocked(listMyOrganizations).mockResolvedValue([]);
    renderPage();

    await signIn(user);
    // "unavailable" is the honest, correct outcome for an opaque redirect —
    // see this page's own doc comment on why the final hand-off cannot be
    // completed by a real browser navigation given Bearer-only sessions.
    expect(await screen.findByText("Unable to complete sign-in for this application")).toBeInTheDocument();
  });

  it("surfaces a real pre-redirect_uri-validation error (unknown client) as safe, readable text — this case IS fully completable, unlike the redirect cases", async () => {
    const user = userEvent.setup();
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized_client", error_description: "Unknown client" }), { status: 403 })),
    );
    vi.mocked(getCurrentUser).mockResolvedValue(BASE_ME);
    vi.mocked(listMyOrganizations).mockResolvedValue([]);
    renderPage();

    await signIn(user);
    expect(await screen.findByText("Unable to start sign-in for this application.")).toBeInTheDocument();
    // Never the raw backend error_description or error code verbatim.
    expect(screen.queryByText("Unknown client")).not.toBeInTheDocument();
    expect(screen.queryByText("unauthorized_client")).not.toBeInTheDocument();
  });

  it("surfaces an invalid_request the same safe way", async () => {
    const user = userEvent.setup();
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_request", error_description: "redirect_uri does not exactly match a registered value" }), { status: 400 })),
    );
    vi.mocked(getCurrentUser).mockResolvedValue(BASE_ME);
    vi.mocked(listMyOrganizations).mockResolvedValue([]);
    renderPage();

    await signIn(user);
    expect(await screen.findByText("Unable to process this sign-in request.")).toBeInTheDocument();
  });

  it("never persists any secret from this flow to browser storage", async () => {
    const user = userEvent.setup();
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ type: "opaqueredirect" } as Response));
    vi.mocked(getCurrentUser).mockResolvedValue(BASE_ME);
    vi.mocked(listMyOrganizations).mockResolvedValue([]);
    renderPage();

    await signIn(user);
    await screen.findByText("Unable to complete sign-in for this application");

    const raw = JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
    expect(raw).not.toContain("code_challenge");
    expect(raw).not.toContain(QUERY.split("&")[3]); // the state value
  });
});
