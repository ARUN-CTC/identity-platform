import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureApiClient, type Permission, type RolePermissionGrant } from "@/shared/api";

import { GrantPermissionDialog } from "./GrantPermissionDialog";

function permission(overrides: Partial<Permission> = {}): Permission {
  return {
    id: "p-view",
    permissionCode: "REPORT_VIEW",
    resource: "REPORT",
    action: "VIEW",
    description: null,
    isSystem: true,
    platformOnly: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function jsonResponse(status: number, data: unknown, message = "ok") {
  return new Response(
    JSON.stringify({ success: status < 300, message, data, errors: status < 300 ? [] : [`ERROR: ${message}`], traceId: "t", timestamp: "now" }),
    { status },
  );
}

function isPermissionsListRequest(url: string): boolean {
  return new URL(url).pathname === "/api/v1/permissions";
}

function renderDialog(catalog: Permission[], currentGrants: RolePermissionGrant[] = [], fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  const fetchMock = vi.fn().mockImplementation(
    fetchImpl ?? (async (url: string) => {
      if (isPermissionsListRequest(url)) {
        return jsonResponse(200, { items: catalog, meta: { page: 1, limit: 200, total: catalog.length, totalPages: 1 } });
      }
      return jsonResponse(200, null);
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GrantPermissionDialog open roleId="role-1" onClose={() => {}} currentGrants={currentGrants} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe("GrantPermissionDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Platform-only permissions can never be attached to a tenant role (a DB
  // trigger blocks it — see grantRolePermission's own doc comment); this
  // is a UX courtesy, not the security boundary, but it must actually work.
  it("never offers a platform-only permission as a selectable option", async () => {
    const user = userEvent.setup();
    renderDialog([permission({ id: "p-tenant", permissionCode: "USER_VIEW" }), permission({ id: "p-platform", permissionCode: "PRODUCT_VIEW", platformOnly: true })]);

    const combobox = await screen.findByRole("combobox", { name: "Permission" });
    await user.click(combobox);

    expect(await screen.findByText("USER_VIEW")).toBeInTheDocument();
    expect(screen.queryByText("PRODUCT_VIEW")).not.toBeInTheDocument();
  });

  it("excludes a permission the role already holds", async () => {
    const user = userEvent.setup();
    renderDialog(
      [permission({ id: "p-view", permissionCode: "USER_VIEW" }), permission({ id: "p-manage", permissionCode: "USER_MANAGE" })],
      [{ id: "g1", roleId: "role-1", permissionId: "p-view", createdAt: "2026-01-01T00:00:00.000Z" }],
    );

    const combobox = await screen.findByRole("combobox", { name: "Permission" });
    await user.click(combobox);

    expect(await screen.findByText("USER_MANAGE")).toBeInTheDocument();
    expect(screen.queryByText("USER_VIEW")).not.toBeInTheDocument();
  });

  it("grants the selected permission on submit", async () => {
    const user = userEvent.setup();
    const fetchMock = renderDialog([permission({ id: "p-view", permissionCode: "USER_VIEW" })], [], async (url, init) => {
      if (isPermissionsListRequest(url)) {
        return jsonResponse(200, { items: [permission({ id: "p-view", permissionCode: "USER_VIEW" })], meta: { page: 1, limit: 200, total: 1, totalPages: 1 } });
      }
      if (typeof url === "string" && url.endsWith("/roles/role-1/permissions") && init?.method === "POST") {
        return jsonResponse(200, { id: "grant-1", roleId: "role-1", permissionId: "p-view", createdAt: "now" });
      }
      return jsonResponse(200, null);
    });

    const combobox = await screen.findByRole("combobox", { name: "Permission" });
    await user.click(combobox);
    await user.click(await screen.findByText("USER_VIEW"));
    await user.click(screen.getByRole("button", { name: "Grant" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/roles/role-1/permissions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // The single most important negative scenario in this module: a caller
  // must never be able to grant a permission they don't themselves hold
  // (and don't have TENANT_MANAGE to bypass with) — real, backend-enforced.
  it("surfaces INSUFFICIENT_PRIVILEGE_TO_GRANT verbatim when the caller lacks the permission themselves", async () => {
    const user = userEvent.setup();
    renderDialog([permission({ id: "p-manage", permissionCode: "USER_MANAGE" })], [], async (url, init) => {
      if (isPermissionsListRequest(url)) {
        return jsonResponse(200, { items: [permission({ id: "p-manage", permissionCode: "USER_MANAGE" })], meta: { page: 1, limit: 200, total: 1, totalPages: 1 } });
      }
      if (typeof url === "string" && url.endsWith("/roles/role-1/permissions") && init?.method === "POST") {
        return jsonResponse(403, null, "Cannot grant 'USER_MANAGE' — you do not hold this permission yourself");
      }
      return jsonResponse(200, null);
    });

    const combobox = await screen.findByRole("combobox", { name: "Permission" });
    await user.click(combobox);
    await user.click(await screen.findByText("USER_MANAGE"));
    await user.click(screen.getByRole("button", { name: "Grant" }));

    expect(await screen.findByText("Cannot grant 'USER_MANAGE' — you do not hold this permission yourself")).toBeInTheDocument();
  });

  it("disables Grant until a permission is selected", async () => {
    renderDialog([permission()]);
    expect(await screen.findByRole("button", { name: "Grant" })).toBeDisabled();
  });
});
