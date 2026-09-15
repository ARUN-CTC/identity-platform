import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth, type LoginCredentials } from "@/app/providers/AuthProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { login, type Session } from "@/shared/api";

import MySessionsPage from "./MySessionsPage";

// Matches test/setup.ts's mocked getCurrentUser — that's the session id
// AuthProvider will expose as `sessionId` once login() resolves.
const CURRENT_SESSION_ID = "test-session-id";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "other-session-id",
    userId: "test-user-id",
    organizationId: null,
    deviceInfo: "Chrome on Windows",
    ipAddress: "203.0.113.5",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-02T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    revokedAt: null,
    revokedReason: null,
    rememberMe: false,
    ...overrides,
  };
}

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

const TEST_CREDENTIALS: LoginCredentials = { tenantCode: "DEFAULT", email: "dev@test.local", password: "irrelevant" };

/** Drives a real login (against test/setup.ts's mocked login/getCurrentUser) so AuthProvider's `sessionId` is populated before the page under test reads it. */
function LoginTrigger() {
  const { login: doLogin } = useAuth();
  useEffect(() => {
    doLogin(TEST_CREDENTIALS).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);
  return null;
}

function renderPage(sessions: Session[]) {
  const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/sessions/me")) return jsonResponse(200, sessions);
    if (url.includes("/sessions/") && init?.method === "DELETE") return jsonResponse(200, null);
    if (url.endsWith("/sessions/revoke-others")) return jsonResponse(200, null);
    if (url.endsWith("/auth/logout")) return jsonResponse(200, null);
    throw new Error(`Unexpected fetch in test: ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotificationProvider>
        <ConfirmProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={["/my-sessions"]}>
              <LoginTrigger />
              <Routes>
                <Route path="/login" element={<div>Login page</div>} />
                <Route path="/my-sessions" element={<MySessionsPage />} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </ConfirmProvider>
      </NotificationProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe("MySessionsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(login).mockClear();
    // AuthProvider persists the refresh token to storage on a successful
    // login (see shared/api/session.ts) — real jsdom storage, which
    // otherwise survives into the next test in this file and makes its
    // bootstrap() attempt a real (unmocked-here) refresh against a token
    // from a previous test, spuriously tripping session-expired.
    localStorage.clear();
    sessionStorage.clear();
  });

  it("labels the session matching AuthProvider's own sessionId as 'This device'", async () => {
    renderPage([
      session({ id: CURRENT_SESSION_ID, deviceInfo: "This browser" }),
      session({ id: "other-session-id", deviceInfo: "Chrome on Windows" }),
    ]);

    const thisDeviceRow = (await screen.findByText("This browser")).closest("li")!;
    expect(within(thisDeviceRow).getByText("This device")).toBeInTheDocument();

    const otherRow = screen.getByText("Chrome on Windows").closest("li")!;
    expect(within(otherRow).queryByText("This device")).not.toBeInTheDocument();
  });

  it("signs out a different device without affecting the current one", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage([
      session({ id: CURRENT_SESSION_ID, deviceInfo: "This browser" }),
      session({ id: "other-session-id", deviceInfo: "Chrome on Windows" }),
    ]);

    const otherRow = (await screen.findByText("Chrome on Windows")).closest("li")!;
    await user.click(within(otherRow).getByRole("button", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("Session signed out.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/sessions/other-session-id"), expect.objectContaining({ method: "DELETE" }));
    // Revoking someone else's session must never navigate this device away.
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  it("revoking the CURRENT session signs this device out and returns to /login — the very next authenticated request would 401 anyway", async () => {
    const user = userEvent.setup();
    renderPage([session({ id: CURRENT_SESSION_ID, deviceInfo: "This browser" })]);

    await screen.findByText("This browser");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("disables 'Sign out of all other devices' when this is the only session", async () => {
    renderPage([session({ id: CURRENT_SESSION_ID, deviceInfo: "This browser" })]);
    await screen.findByText("This browser");
    expect(screen.getByRole("button", { name: "Sign out of all other devices" })).toBeDisabled();
  });
});
