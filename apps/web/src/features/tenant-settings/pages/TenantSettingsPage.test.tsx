import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth, type LoginCredentials } from "@/app/providers/AuthProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { TenantProvider } from "@/app/providers/TenantProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { login, type TenantRecord } from "@/shared/api";

import TenantSettingsPage from "./TenantSettingsPage";

// Matches test/setup.ts's mocked getCurrentUser — AuthProvider will expose
// this as `useTenant().tenant.id`, the ONLY id TenantSettingsPage is allowed
// to request (see shared/api/tenants.ts's header comment).
const OWN_TENANT_ID = "test-tenant-id";
const OTHER_TENANT_ID = "some-other-tenant-uuid-belonging-to-someone-else";

function tenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: OWN_TENANT_ID,
    tenantCode: "DEFAULT",
    tenantName: "Default Tenant",
    legalName: "Default Tenant LLC",
    email: "ops@default-tenant.example",
    phone: "+1-555-0100",
    status: "ACTIVE",
    activatedAt: "2026-01-01T00:00:00.000Z",
    suspendedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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

/** Drives a real login (against test/setup.ts's mocked login/getCurrentUser) so AuthProvider's `tenant` is populated before the page under test reads it. */
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
          <AuthProvider>
            <TenantProvider>
              <MemoryRouter initialEntries={["/tenant-settings"]}>
                <LoginTrigger />
                <Routes>
                  <Route path="/login" element={<div>Login page</div>} />
                  <Route path="/tenant-settings" element={<TenantSettingsPage />} />
                </Routes>
              </MemoryRouter>
            </TenantProvider>
          </AuthProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
  return fetchMock;
}

describe("TenantSettingsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(login).mockClear();
    // See MySessionsPage.test.tsx's identical comment: AuthProvider persists
    // a refresh token to real jsdom storage on login, which otherwise leaks
    // into the next test's bootstrap.
    localStorage.clear();
    sessionStorage.clear();
  });

  it("loads and displays this tenant's own settings", async () => {
    renderPage(async (url) => {
      if (url.endsWith(`/tenants/${OWN_TENANT_ID}`)) return jsonResponse(200, tenant());
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    expect(await screen.findByRole("heading", { name: "Default Tenant" })).toBeInTheDocument();
    // "DEFAULT" (tenant code) legitimately renders twice — once in the
    // PageHeader subtitle, once in the details card — both are real,
    // non-conflicting occurrences of the same field.
    expect(screen.getAllByText("DEFAULT").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("ops@default-tenant.example")).toBeInTheDocument();
    // "Active" also renders twice — the StatusBadge chip and the details card's own Status field.
    expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(2);
  });

  it("requests only this caller's own tenant id — never any other id, never a route param", async () => {
    const fetchMock = renderPage(async (url) => {
      if (url.endsWith(`/tenants/${OWN_TENANT_ID}`)) return jsonResponse(200, tenant());
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    await screen.findByRole("heading", { name: "Default Tenant" });

    const tenantUrls = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes("/tenants/"));
    expect(tenantUrls.length).toBeGreaterThan(0);
    for (const url of tenantUrls) {
      expect(url.endsWith(`/tenants/${OWN_TENANT_ID}`)).toBe(true);
      expect(url).not.toContain(OTHER_TENANT_ID);
    }
    // No list endpoint (GET /tenants, no id) is ever called from this page —
    // the backend's list is platform-wide and unscoped (see
    // shared/api/tenants.ts), and this app never exposes it.
    const listCalls = fetchMock.mock.calls.map((c) => new URL(c[0] as string).pathname).filter((path) => /\/tenants$/.test(path));
    expect(listCalls).toEqual([]);
  });

  it("shows the real backend error message when the tenant fails to load", async () => {
    renderPage(async (url) => {
      if (url.endsWith(`/tenants/${OWN_TENANT_ID}`)) return jsonResponse(500, null, "An unexpected error occurred");
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    expect(await screen.findByText("Something went wrong on our end. Please try again.")).toBeInTheDocument();
  });

  it("edits the safe profile fields and saves, without ever offering a status or tenant-id control", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async (url, init) => {
      if (url.endsWith(`/tenants/${OWN_TENANT_ID}`) && (init?.method ?? "GET") === "GET") {
        return jsonResponse(200, tenant());
      }
      if (url.endsWith(`/tenants/${OWN_TENANT_ID}`) && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        return jsonResponse(200, tenant({ tenantName: body.tenantName }));
      }
      throw new Error(`Unexpected fetch in test: ${url} ${init?.method ?? "GET"}`);
    });

    await screen.findByRole("heading", { name: "Default Tenant" });
    await user.click(screen.getByRole("button", { name: "Edit tenant settings" }));

    await screen.findByRole("dialog");
    // No status field and no id/tenant-picker field anywhere in the form —
    // lifecycle control is out of scope for this tenant's own settings (see
    // TenantSettingsPage's doc comment).
    expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();

    // MUI appends a literal " *" text node inside a required field's <label>
    // (MuiFormLabel-asterisk), so the label's accessible text is "Tenant
    // name *", not "Tenant name" — an exact match needs `exact: false`.
    const nameInput = screen.getByLabelText("Tenant name", { exact: false });
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Tenant");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Tenant settings were updated successfully.")).toBeInTheDocument();
    const patchCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    expect((patchCall[0] as string).endsWith(`/tenants/${OWN_TENANT_ID}`)).toBe(true);
    const patchBody = JSON.parse((patchCall[1] as RequestInit).body as string);
    expect(patchBody).not.toHaveProperty("status");
    expect(patchBody).not.toHaveProperty("id");
  });
});
