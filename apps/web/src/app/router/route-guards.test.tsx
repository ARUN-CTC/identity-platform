import { render } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { login } from "@/shared/api";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth, type LoginCredentials } from "@/app/providers/AuthProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { TestPermissionProvider } from "@/app/providers/PermissionProvider";
import { QueryProvider } from "@/app/providers/QueryProvider";

import { PermissionRoute, ProtectedRoute } from "./route-guards";

const TEST_CREDENTIALS: LoginCredentials = { tenantCode: "DEFAULT", email: "dev@test.local", password: "irrelevant" };

/**
 * There is no automatic dev-bootstrap login in test runs (AuthProvider's
 * DEV_LOGIN requires real env vars — see its own doc comment; none are set
 * here), so AuthProvider's bootstrap resolves to signed-out almost
 * immediately, same as a real first visit — ProtectedRoute redirects to
 * /login exactly as it would for a real unauthenticated user. This drives
 * the exact same `useAuth().login()` + post-success `navigate()` a real
 * LoginPage submit does, against the mocked `login`/`getCurrentUser`/
 * `listMyOrganizations` from test/setup.ts, so the test exercises the same
 * redirect-to-login-then-back sequence a real interactive sign-in goes
 * through. Errors are swallowed the same way LoginPage's own submit
 * handler catches them — a rejected login() never becomes an unhandled
 * rejection here.
 */
function LoginTrigger({ redirectTo = "/dashboard" }: { redirectTo?: string }) {
  const { login: doLogin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    doLogin(TEST_CREDENTIALS)
      .then(() => navigate(redirectTo, { replace: true }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);
  return null;
}

describe("ProtectedRoute", () => {
  it("renders the protected route tree once login succeeds", async () => {
    const { findByText } = render(
      <QueryProvider>
        <NotificationProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={["/dashboard"]}>
              <LoginTrigger />
              <Routes>
                <Route path="/login" element={<div>Login page</div>} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/dashboard" element={<div>Dashboard content</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </NotificationProvider>
      </QueryProvider>,
    );
    expect(await findByText("Dashboard content")).toBeInTheDocument();
  });

  it("redirects to /login when login fails", async () => {
    vi.mocked(login).mockRejectedValueOnce(new Error("invalid credentials"));

    const { findByText } = render(
      <QueryProvider>
        <NotificationProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={["/dashboard"]}>
              <LoginTrigger />
              <Routes>
                <Route path="/login" element={<div>Login page</div>} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/dashboard" element={<div>Dashboard content</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </NotificationProvider>
      </QueryProvider>,
    );
    expect(await findByText("Login page")).toBeInTheDocument();
  });

  /**
   * The case ProtectedRoute's `state: { from: location }` capture exists
   * for — an unauthenticated user hitting a protected deep link, with no
   * login attempt in flight at all.
   */
  it("preserves the originally-requested location in state.from when redirecting an unauthenticated user, for the login page to restore afterward", async () => {
    const { findByText } = render(
      <QueryProvider>
        <NotificationProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={["/users/some-record-id"]}>
              <Routes>
                <Route path="/login" element={<LocationStateProbe />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/users/:id" element={<div>User detail</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </NotificationProvider>
      </QueryProvider>,
    );
    expect(await findByText("from: /users/some-record-id")).toBeInTheDocument();
  });
});

/** Renders the `state.from.pathname` LoginPage itself would read to decide where to send the user back to. */
function LocationStateProbe() {
  const location = useLocation() as { state?: { from?: { pathname?: string } } };
  return <div>from: {location.state?.from?.pathname ?? "(none)"}</div>;
}

describe("PermissionRoute", () => {
  it("renders its route when the user has the required permission", () => {
    const { getByText } = render(
      <TestPermissionProvider grantedPermissions={["ORGANIZATION_MANAGE"]}>
        <MemoryRouter initialEntries={["/organizations"]}>
          <Routes>
            <Route path="/403" element={<div>Forbidden</div>} />
            <Route path="/organizations" element={<PermissionRoute permission="ORGANIZATION_MANAGE" />}>
              <Route index element={<div>Organizations content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TestPermissionProvider>,
    );
    expect(getByText("Organizations content")).toBeInTheDocument();
  });

  it("redirects to /403 when the user lacks the required permission", () => {
    const { getByText, queryByText } = render(
      <TestPermissionProvider grantedPermissions={["USER_VIEW"]}>
        <MemoryRouter initialEntries={["/organizations"]}>
          <Routes>
            <Route path="/403" element={<div>Forbidden</div>} />
            <Route path="/organizations" element={<PermissionRoute permission="ORGANIZATION_MANAGE" />}>
              <Route index element={<div>Organizations content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TestPermissionProvider>,
    );
    expect(getByText("Forbidden")).toBeInTheDocument();
    expect(queryByText("Organizations content")).not.toBeInTheDocument();
  });
});
