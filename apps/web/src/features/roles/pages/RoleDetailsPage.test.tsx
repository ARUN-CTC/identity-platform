import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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

import RoleDetailsPage from "./RoleDetailsPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function renderPage(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(fetchImpl));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <ConfirmProvider>
            <TestPermissionProvider grantedPermissions={[PERMS.ROLE_VIEW, PERMS.ROLE_MANAGE]}>
              <MemoryRouter initialEntries={["/roles/role-1"]}>
                <BreadcrumbLabelProvider>
                  <Routes>
                    <Route path="/roles/:id" element={<RoleDetailsPage />} />
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

describe("RoleDetailsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides Edit/Delete for a system role — the backend rejects both with 400 SYSTEM_ROLE_IMMUTABLE regardless", async () => {
    renderPage(async (url) => {
      if (typeof url === "string" && url.endsWith("/roles/role-1")) {
        return jsonResponse(200, { id: "role-1", tenantId: null, roleCode: "TENANT_ADMIN", roleName: "Tenant Administrator", isSystem: true });
      }
      return jsonResponse(200, []);
    });

    expect(await screen.findByRole("heading", { name: "Tenant Administrator" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete role" })).not.toBeInTheDocument();
    expect(screen.getByText("System role")).toBeInTheDocument();
  });

  it("offers Edit/Delete for a custom role", async () => {
    renderPage(async (url) => {
      if (typeof url === "string" && url.endsWith("/roles/role-1")) {
        return jsonResponse(200, { id: "role-1", tenantId: "t1", roleCode: "BILLING_MANAGER", roleName: "Billing Manager", isSystem: false });
      }
      return jsonResponse(200, []);
    });

    expect(await screen.findByRole("heading", { name: "Billing Manager" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit role" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete role" })).toBeInTheDocument();
  });

  it("surfaces the real 409 when deleting a role still assigned to users", async () => {
    const user = userEvent.setup();
    renderPage(async (url, init) => {
      if (typeof url === "string" && url.endsWith("/roles/role-1") && (!init || init.method === undefined || init.method === "GET")) {
        return jsonResponse(200, { id: "role-1", tenantId: "t1", roleCode: "BILLING_MANAGER", roleName: "Billing Manager", isSystem: false });
      }
      if (typeof url === "string" && url.endsWith("/roles/role-1") && init?.method === "DELETE") {
        return jsonResponse(409, null, "'BILLING_MANAGER' is currently assigned to 2 users and cannot be deleted");
      }
      return jsonResponse(200, []);
    });

    await screen.findByRole("heading", { name: "Billing Manager" });
    await user.click(screen.getByRole("button", { name: "Delete role" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("'BILLING_MANAGER' is currently assigned to 2 users and cannot be deleted")).toBeInTheDocument();
  });
});
