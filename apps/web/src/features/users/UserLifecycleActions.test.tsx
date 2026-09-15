import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { configureApiClient, type User } from "@/shared/api";

import { UserLifecycleActions } from "./UserLifecycleActions";

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "dev@test.local",
    username: null,
    firstName: "Dev",
    lastName: "User",
    status: "ACTIVE",
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    version: "1",
    ...overrides,
  };
}

function renderActions(user: User) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationProvider>
        <ConfirmProvider>
          <UserLifecycleActions user={user} />
        </ConfirmProvider>
      </NotificationProvider>
    </QueryClientProvider>,
  );
}

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

describe("UserLifecycleActions", () => {
  beforeEach(() => {
    configureApiClient({ baseUrl: "http://test.local/api/v1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Mirrors LIFECYCLE_TRANSITIONS in src/modules/users/services/users.service.ts exactly.
  it("offers Activate + Deactivate for a PROVISIONED user", () => {
    renderActions(baseUser({ status: "PROVISIONED" }));
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
  });

  it("offers Suspend + Deactivate for an ACTIVE user", () => {
    renderActions(baseUser({ status: "ACTIVE" }));
    expect(screen.getByRole("button", { name: "Suspend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
  });

  it("offers Activate + Deactivate for a SUSPENDED user", () => {
    renderActions(baseUser({ status: "SUSPENDED" }));
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("offers no lifecycle actions for a DEACTIVATED user — it is a real terminal state, not a frontend restriction", () => {
    renderActions(baseUser({ status: "DEACTIVATED" }));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/terminal state/i)).toBeInTheDocument();
  });

  it("suspends after confirmation and shows a success notification", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, baseUser({ status: "SUSPENDED" })));
    vi.stubGlobal("fetch", fetchMock);

    renderActions(baseUser({ status: "ACTIVE" }));
    await user.click(screen.getByRole("button", { name: "Suspend" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Suspend" }));

    expect(await screen.findByText(/was suspended successfully/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/users/user-1/suspend",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not call the API when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, baseUser({ status: "SUSPENDED" })));
    vi.stubGlobal("fetch", fetchMock);

    renderActions(baseUser({ status: "ACTIVE" }));
    await user.click(screen.getByRole("button", { name: "Suspend" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A status change made in another tab/browser between page load and the
  // button press is exactly what INVALID_USER_TRANSITION guards against —
  // this must surface as a real, specific error, never a silent success.
  it("surfaces the backend's specific INVALID_USER_TRANSITION message on a stale-state conflict", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, null, "Cannot suspend a user in status DEACTIVATED (must be one of: ACTIVE)"),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderActions(baseUser({ status: "ACTIVE" }));
    await user.click(screen.getByRole("button", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Suspend" }));

    expect(await screen.findByText("Cannot suspend a user in status DEACTIVATED (must be one of: ACTIVE)")).toBeInTheDocument();
  });
});
