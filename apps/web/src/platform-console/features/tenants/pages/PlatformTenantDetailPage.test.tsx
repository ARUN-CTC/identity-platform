import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { configurePlatformApiClient } from "@/shared/platform-api";
import type { PlatformTenant } from "@/shared/platform-api";

import PlatformTenantDetailPage from "./PlatformTenantDetailPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function tenant(overrides: Partial<PlatformTenant> = {}): PlatformTenant {
  return {
    id: "tenant-1",
    tenantCode: "FLEETOPS",
    tenantName: "Fleet Ops HQ",
    legalName: null,
    email: null,
    phone: null,
    status: "PROVISIONING",
    activatedAt: null,
    suspendedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function renderPage(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  configurePlatformApiClient({ baseUrl: "http://test.local/api/v1", getAccessToken: () => "test-platform-token" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <ConfirmProvider>
            <MemoryRouter initialEntries={["/platform-console/tenants/tenant-1"]}>
              <Routes>
                <Route path="/platform-console/tenants/:id" element={<PlatformTenantDetailPage />} />
                <Route path="/platform-console/tenants" element={<div>Tenant registry page</div>} />
              </Routes>
            </MemoryRouter>
          </ConfirmProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
  return fetchMock;
}

function withStandardRoutes(overrides: { tenant?: PlatformTenant; onBootstrap?: (body: Record<string, unknown>) => Response | Promise<Response> }) {
  return async (url: string, init?: RequestInit) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/api/v1/platform/tenants/tenant-1" && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, overrides.tenant ?? tenant());
    }
    if (pathname === "/api/v1/products" && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, {
        items: [
          { id: "product-1", name: "TravelOS", slug: "travelos", description: null, status: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: null },
          { id: "product-2", name: "Banking AI", slug: "banking-ai", description: null, status: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: null },
        ],
        meta: { page: 1, limit: 200, total: 2, totalPages: 1 },
      });
    }
    if (pathname === "/api/v1/platform/tenants/tenant-1/bootstrap" && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      if (overrides.onBootstrap) return overrides.onBootstrap(body);
      return jsonResponse(201, {
        tenant: tenant({ status: "PROVISIONING" }),
        organization: { id: "org-1", tenantId: "tenant-1", organizationCode: "FLEETOPS-ORG", organizationName: body.organizationName, status: "ACTIVE" },
        administrator: { id: "admin-1", email: body.administratorEmail, isNewIdentity: true },
        membership: { id: "membership-1", status: "INVITED" },
        roleAssigned: "TENANT_ADMIN",
        entitlements: (body.productIds ?? []).map((id: string) => ({ productId: id, status: "ACTIVE" })),
        invitationSent: true,
      });
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
  };
}

describe("PlatformTenantDetailPage — tenant bootstrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the bootstrap call-to-action for a PROVISIONING tenant, and hides it once ACTIVE", async () => {
    renderPage(withStandardRoutes({}));
    expect(await screen.findByRole("button", { name: /Bootstrap tenant/i })).toBeInTheDocument();
  });

  it("does not offer bootstrap for an already-ACTIVE tenant", async () => {
    renderPage(withStandardRoutes({ tenant: tenant({ status: "ACTIVE" }) }));
    await screen.findByRole("heading", { name: "Fleet Ops HQ" });
    expect(screen.queryByRole("button", { name: /Bootstrap tenant/i })).not.toBeInTheDocument();
  });

  it("collects no password anywhere in the wizard — administrator activation is invitation-only", async () => {
    const user = userEvent.setup();
    renderPage(withStandardRoutes({}));

    await user.click(await screen.findByRole("button", { name: /Bootstrap tenant/i }));
    const dialog = await screen.findByRole("dialog");
    // Step 2 — Administrator.
    await user.type(within(dialog).getByLabelText(/Organization name/i), "Fleet Ops Org");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/set their own password via the standard invitation flow/i)).toBeInTheDocument();
  });

  it("completes all steps and submits exactly one bootstrap call with the full, correct payload", async () => {
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = renderPage(
      withStandardRoutes({
        onBootstrap: (body) => {
          capturedBody = body;
          return jsonResponse(201, {
            tenant: tenant(),
            organization: { id: "org-1", tenantId: "tenant-1", organizationCode: "FLEETOPS-ORG", organizationName: body.organizationName as string, status: "ACTIVE" },
            administrator: { id: "admin-1", email: body.administratorEmail, isNewIdentity: true },
            membership: { id: "membership-1", status: "INVITED" },
            roleAssigned: "TENANT_ADMIN",
            entitlements: [{ productId: "product-1", status: "ACTIVE" }],
            invitationSent: true,
          });
        },
      }),
    );

    await user.click(await screen.findByRole("button", { name: /Bootstrap tenant/i }));
    const dialog = await screen.findByRole("dialog");

    // Step 1 — Organization
    await user.type(within(dialog).getByLabelText(/Organization name/i), "Fleet Ops Org");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    // Step 2 — Administrator
    await user.type(within(dialog).getByLabelText(/Email/i), "admin@fleetops.example");
    await user.type(within(dialog).getByLabelText(/First name/i), "Ada");
    await user.type(within(dialog).getByLabelText(/Last name/i), "Min");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    // Step 3 — Product access
    await screen.findByText("TravelOS");
    await user.click(within(dialog).getByRole("checkbox", { name: /TravelOS/ }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    // Step 4 — Review
    expect(within(dialog).getByText(/Fleet Ops Org/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Ada Min/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Bootstrap tenant" }));

    expect(await screen.findByText(/was bootstrapped/i)).toBeInTheDocument();
    expect(capturedBody).toEqual({
      organizationName: "Fleet Ops Org",
      organizationCode: undefined,
      administratorEmail: "admin@fleetops.example",
      administratorFirstName: "Ada",
      administratorLastName: "Min",
      productIds: ["product-1"],
    });
    const bootstrapCalls = fetchMock.mock.calls.filter((c) => new URL(c[0] as string).pathname.endsWith("/bootstrap"));
    expect(bootstrapCalls).toHaveLength(1);
  });

  it("surfaces a 409 (already bootstrapped / not PROVISIONING) verbatim, without closing the wizard silently", async () => {
    const user = userEvent.setup();
    renderPage(withStandardRoutes({ onBootstrap: () => jsonResponse(409, null, "This tenant has already been bootstrapped") }));

    await user.click(await screen.findByRole("button", { name: /Bootstrap tenant/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Organization name/i), "Org");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.type(within(dialog).getByLabelText(/Email/i), "a@example.com");
    await user.type(within(dialog).getByLabelText(/First name/i), "A");
    await user.type(within(dialog).getByLabelText(/Last name/i), "A");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await screen.findByText("TravelOS");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Bootstrap tenant" }));

    expect(await screen.findByText("This tenant has already been bootstrapped")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
