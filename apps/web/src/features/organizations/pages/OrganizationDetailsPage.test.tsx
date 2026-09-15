import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BreadcrumbLabelProvider } from "@/app/router/BreadcrumbLabel";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { TestPermissionProvider } from "@/app/providers/PermissionProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { configureApiClient } from "@/shared/api";
import { PERMISSIONS as PERMS } from "@/shared/auth/permissions";

import OrganizationDetailsPage from "./OrganizationDetailsPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function renderPage(grantedPermissions: string[], fetchImpl: (url: string) => Promise<Response>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(fetchImpl));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <ConfirmProvider>
            <TestPermissionProvider grantedPermissions={grantedPermissions}>
              <MemoryRouter initialEntries={["/organizations/org-1"]}>
                <BreadcrumbLabelProvider>
                  <Routes>
                    <Route path="/organizations/:id" element={<OrganizationDetailsPage />} />
                  </Routes>
                </BreadcrumbLabelProvider>
              </MemoryRouter>
            </TestPermissionProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
}

const ORG = {
  id: "org-1",
  organizationTypeId: "type-1",
  organizationCode: "ACME",
  organizationName: "Acme Corp",
  legalName: null,
  email: null,
  phone: null,
  website: null,
  status: "ACTIVE" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("OrganizationDetailsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and displays the organization overview", async () => {
    renderPage([PERMS.ORGANIZATION_MANAGE], async (url) => {
      if (typeof url === "string" && url.endsWith("/organizations/org-1")) return jsonResponse(200, ORG);
      return jsonResponse(200, null);
    });

    expect(await screen.findByRole("heading", { name: "Acme Corp" })).toBeInTheDocument();
    // "ACME" appears twice by design — once as the PageHeader's subtitle,
    // once as the Overview card's own "Organization code" field.
    expect(screen.getAllByText("ACME").length).toBeGreaterThan(0);
  });

  // organization has RLS scoped to the caller's own tenant — a cross-tenant
  // or nonexistent id both surface as the same 404, never leaking which
  // case it was.
  it("shows a real error state for a cross-tenant or nonexistent organization, not a crash", async () => {
    renderPage([PERMS.ORGANIZATION_MANAGE], async () => jsonResponse(404, null, "Organization 'org-1' not found"));

    expect(await screen.findByText("Unable to load this organization")).toBeInTheDocument();
    expect(screen.getByText("Organization 'org-1' not found")).toBeInTheDocument();
  });

  it("denies the Members tab when the caller holds neither USER_VIEW nor USER_MANAGE — a real permission mismatch ORGANIZATION_MANAGE alone doesn't cover", async () => {
    const user = userEvent.setup();
    renderPage([PERMS.ORGANIZATION_MANAGE], async (url) => {
      if (typeof url === "string" && url.endsWith("/organizations/org-1")) return jsonResponse(200, ORG);
      return jsonResponse(200, { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    });

    await screen.findByRole("heading", { name: "Acme Corp" });
    await user.click(screen.getByRole("tab", { name: "Members" }));

    expect(await screen.findByText("You don't have permission to view members")).toBeInTheDocument();
  });

  it("shows members read-only (no status/resend actions) when the caller holds USER_VIEW but not USER_MANAGE", async () => {
    const user = userEvent.setup();
    renderPage([PERMS.ORGANIZATION_MANAGE, PERMS.USER_VIEW], async (url) => {
      if (typeof url === "string" && url.endsWith("/organizations/org-1")) return jsonResponse(200, ORG);
      if (typeof url === "string" && url.includes("/members")) {
        return jsonResponse(200, {
          items: [
            {
              id: "m-1",
              tenantId: "t1",
              organizationId: "org-1",
              userId: "u1",
              status: "ACTIVE",
              createdAt: "2026-01-01T00:00:00.000Z",
              user: { id: "u1", email: "member@test.local", firstName: "Mem", lastName: "Ber", status: "ACTIVE" },
            },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }
      return jsonResponse(200, null);
    });

    await screen.findByRole("heading", { name: "Acme Corp" });
    await user.click(screen.getByRole("tab", { name: "Members" }));

    expect(await screen.findByText("member@test.local")).toBeInTheDocument();
    // USER_MANAGE-gated actions must not render for a USER_VIEW-only caller.
    expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
  });
});
