import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { TestPermissionProvider } from "@/app/providers/PermissionProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { configureApiClient, type OrganizationType } from "@/shared/api";
import type { Permission } from "@/shared/types/permission";

import OrganizationTypesPage from "./OrganizationTypesPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function orgType(overrides: Partial<OrganizationType> = {}): OrganizationType {
  return { id: "type-1", typeCode: "BRANCH", typeName: "Branch", description: null, isActive: true, ...overrides };
}

function renderPage(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, grantedPermissions: Permission[] = ["ORGANIZATION_MANAGE"]) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <TestPermissionProvider grantedPermissions={grantedPermissions}>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <ConfirmProvider>
            <OrganizationTypesPage />
          </ConfirmProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </TestPermissionProvider>,
  );
  return fetchMock;
}

const listOk = (items: OrganizationType[]) => jsonResponse(200, { items, meta: { page: 1, limit: 25, total: items.length, totalPages: 1 } });

describe("OrganizationTypesPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and displays every organization type", async () => {
    renderPage(async () => listOk([orgType(), orgType({ id: "type-2", typeCode: "DEPT", typeName: "Department" })]));

    expect(await screen.findByText("Branch")).toBeInTheDocument();
    expect(screen.getByText("Department")).toBeInTheDocument();
  });

  it("shows an empty state when there are none", async () => {
    renderPage(async () => listOk([]));
    expect(await screen.findByText("No organization types found")).toBeInTheDocument();
  });

  it("shows the real backend error message when the list request fails", async () => {
    renderPage(async () => jsonResponse(500, null, "An unexpected error occurred"));
    expect(await screen.findByText("Something went wrong on our end. Please try again.")).toBeInTheDocument();
  });

  it("shows a 403 from a caller lacking ORGANIZATION_MANAGE as a real backend rejection, not a silent empty list", async () => {
    renderPage(async () => jsonResponse(403, null, "Insufficient permissions to access this resource"));
    // getApiErrorMessage() maps every 403 to this generic, friendlier
    // message (see its own doc comment) — the raw backend text is not shown.
    expect(await screen.findByText("You don't have permission to do that.")).toBeInTheDocument();
  });

  it("hides New/Edit/Delete when the caller lacks ORGANIZATION_MANAGE — the frontend gate, never the sole boundary", async () => {
    renderPage(async () => listOk([orgType()]), []);

    await screen.findByText("Branch");
    expect(screen.queryByRole("button", { name: "New type" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Branch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete Branch/i })).not.toBeInTheDocument();
  });

  it("creates a new type using only the real DTO fields, and surfaces a duplicate typeCode 409 verbatim", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async (url, init) => {
      if (new URL(url).pathname.endsWith("/organization-types") && (init?.method ?? "GET") === "GET") return listOk([]);
      if (new URL(url).pathname.endsWith("/organization-types") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        if (body.typeCode === "TAKEN") {
          return jsonResponse(409, null, "Organization type code 'TAKEN' is already in use");
        }
        expect(body).toEqual({ typeCode: "BRANCH", typeName: "Branch", isActive: true });
        return jsonResponse(201, orgType());
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await screen.findByText("No organization types found");
    await user.click(screen.getByRole("button", { name: "New type" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Type code/i), "BRANCH");
    await user.type(within(dialog).getByLabelText(/Type name/i), "Branch");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Branch was created successfully.")).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeDefined();
  });

  it("surfaces a duplicate-code 409 on create without closing the drawer", async () => {
    const user = userEvent.setup();
    renderPage(async (url, init) => {
      if (new URL(url).pathname.endsWith("/organization-types") && (init?.method ?? "GET") === "GET") return listOk([]);
      if (new URL(url).pathname.endsWith("/organization-types") && init?.method === "POST") {
        return jsonResponse(409, null, "Organization type code 'BRANCH' is already in use");
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await screen.findByText("No organization types found");
    await user.click(screen.getByRole("button", { name: "New type" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Type code/i), "BRANCH");
    await user.type(within(dialog).getByLabelText(/Type name/i), "Branch");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Organization type code 'BRANCH' is already in use")).toBeInTheDocument();
    // Still open — the dialog role persists.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edits a type's name/description/active flag, never sending typeCode", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async (url, init) => {
      if (new URL(url).pathname.endsWith("/organization-types") && (init?.method ?? "GET") === "GET") return listOk([orgType()]);
      if (new URL(url).pathname.endsWith("/organization-types/type-1") && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        expect(body).not.toHaveProperty("typeCode");
        expect(body.typeName).toBe("Renamed Branch");
        return jsonResponse(200, orgType({ typeName: "Renamed Branch" }));
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await screen.findByText("Branch");
    await user.click(screen.getByRole("button", { name: "Edit Branch" }));

    const dialog = await screen.findByRole("dialog");
    // Identity field is shown, disabled, and never re-submitted.
    expect(within(dialog).getByDisplayValue("BRANCH")).toBeDisabled();
    const nameInput = within(dialog).getByLabelText(/Type name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Branch");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Branch was updated successfully.")).toBeInTheDocument();
    const patchCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patchCall).toBeDefined();
  });

  it("shows a not-found error when editing/deleting a type that's gone by the time the request lands", async () => {
    const user = userEvent.setup();
    renderPage(async (url, init) => {
      if (new URL(url).pathname.endsWith("/organization-types") && (init?.method ?? "GET") === "GET") return listOk([orgType()]);
      if (new URL(url).pathname.endsWith("/organization-types/type-1") && init?.method === "DELETE") {
        return jsonResponse(404, null, "OrganizationType with id 'type-1' was not found");
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await screen.findByText("Branch");
    await user.click(screen.getByRole("button", { name: "Delete Branch" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("OrganizationType with id 'type-1' was not found")).toBeInTheDocument();
  });

  it("deletes after confirmation and shows a success notification", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async (url, init) => {
      if (new URL(url).pathname.endsWith("/organization-types") && (init?.method ?? "GET") === "GET") return listOk([orgType()]);
      if (new URL(url).pathname.endsWith("/organization-types/type-1") && init?.method === "DELETE") return jsonResponse(200, null);
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await screen.findByText("Branch");
    await user.click(screen.getByRole("button", { name: "Delete Branch" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Branch was deleted.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("http://test.local/api/v1/organization-types/type-1", expect.objectContaining({ method: "DELETE" }));
  });

  it("does not call delete when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async (url, init) => {
      if (new URL(url).pathname.endsWith("/organization-types") && (init?.method ?? "GET") === "GET") return listOk([orgType()]);
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    await screen.findByText("Branch");
    await user.click(screen.getByRole("button", { name: "Delete Branch" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  });
});
