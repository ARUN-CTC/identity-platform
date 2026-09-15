import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { configurePlatformApiClient } from "@/shared/platform-api";
import type { PlatformTenant } from "@/shared/platform-api";

import PlatformTenantsPage from "./PlatformTenantsPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  return new Response(
    JSON.stringify({ success: status < 300, message, data, errors: status < 300 ? [] : [`ERROR: ${message}`], traceId: "t", timestamp: "now" }),
    { status },
  );
}

function tenant(overrides: Partial<PlatformTenant> = {}): PlatformTenant {
  return {
    id: "tenant-1",
    tenantCode: "ACME",
    tenantName: "Acme Corp",
    legalName: null,
    email: "ops@acme.example",
    phone: null,
    status: "ACTIVE",
    activatedAt: "2026-01-01T00:00:00.000Z",
    suspendedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
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
          <MemoryRouter initialEntries={["/platform-console/tenants"]}>
            <Routes>
              <Route path="/platform-console/tenants" element={<PlatformTenantsPage />} />
              <Route path="/platform-console/tenants/:id" element={<div>Tenant detail page</div>} />
            </Routes>
          </MemoryRouter>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
  return fetchMock;
}

describe("PlatformTenantsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and displays every tenant on the platform, and authenticates via the platform bearer token", async () => {
    const fetchMock = renderPage(async (url) => {
      if (new URL(url).pathname.endsWith("/platform/tenants")) {
        return jsonResponse(200, { items: [tenant(), tenant({ id: "tenant-2", tenantCode: "GLOBEX", tenantName: "Globex Inc" })], meta: { page: 1, limit: 25, total: 2, totalPages: 1 } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Globex Inc")).toBeInTheDocument();

    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-platform-token");
  });

  it("shows the real backend error message when the request fails", async () => {
    renderPage(async () => jsonResponse(500, null, "An unexpected error occurred"));
    expect(await screen.findByText("Something went wrong on our end. Please try again.")).toBeInTheDocument();
  });

  it("navigates to the tenant detail page on row click", async () => {
    const user = userEvent.setup();
    renderPage(async (url) => {
      if (new URL(url).pathname.endsWith("/platform/tenants")) {
        return jsonResponse(200, { items: [tenant()], meta: { page: 1, limit: 25, total: 1, totalPages: 1 } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await user.click(await screen.findByText("Acme Corp"));
    expect(await screen.findByText("Tenant detail page")).toBeInTheDocument();
  });

  it("registers a new tenant via the create drawer, using only the real DTO fields", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith("/platform/tenants") && (init?.method ?? "GET") === "GET") {
        return jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } });
      }
      if (pathname.endsWith("/platform/tenants") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ tenantCode: "NEWCO", tenantName: "New Co" });
        return jsonResponse(201, tenant({ id: "new-tenant", tenantCode: "NEWCO", tenantName: "New Co" }));
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await screen.findByText("No tenants registered yet");
    await user.click(screen.getByRole("button", { name: "Register tenant" }));

    await screen.findByRole("dialog");
    await user.type(screen.getByLabelText(/Tenant code/i), "NEWCO");
    await user.type(screen.getByLabelText(/Tenant name/i), "New Co");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Tenant detail page");
    const postCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeDefined();
  });
});
