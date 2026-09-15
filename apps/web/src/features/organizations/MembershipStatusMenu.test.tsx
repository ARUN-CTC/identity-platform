import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth, type LoginCredentials } from "@/app/providers/AuthProvider";
import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ConfirmProvider } from "@/design-system/patterns/confirmation";
import { configureApiClient, type Member } from "@/shared/api";

import { MembershipStatusMenu } from "./MembershipStatusMenu";

// Matches test/setup.ts's mocked getCurrentUser.
const CURRENT_USER_ID = "test-user-id";
const TEST_CREDENTIALS: LoginCredentials = { tenantCode: "DEFAULT", email: "dev@test.local", password: "irrelevant" };

function LoginTrigger() {
  const { login } = useAuth();
  useEffect(() => {
    login(TEST_CREDENTIALS).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);
  return null;
}

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: "m-1",
    tenantId: "test-tenant-id",
    organizationId: "org-1",
    userId: "other-user-id",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    user: { id: "other-user-id", email: "other@test.local", firstName: "Other", lastName: "Person", status: "ACTIVE" },
    ...overrides,
  };
}

function jsonResponse(status: number, data: unknown, message = "ok") {
  return new Response(
    JSON.stringify({ success: status < 300, message, data, errors: status < 300 ? [] : [`ERROR: ${message}`], traceId: "t", timestamp: "now" }),
    { status },
  );
}

function renderMenu(m: Member, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl ?? (async () => jsonResponse(200, m)));
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotificationProvider>
        <ConfirmProvider>
          <AuthProvider>
            <LoginTrigger />
            <MembershipStatusMenu organizationId="org-1" member={m} />
          </AuthProvider>
        </ConfirmProvider>
      </NotificationProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe("MembershipStatusMenu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("never offers the member's own current status as an option", async () => {
    const user = userEvent.setup();
    renderMenu(member({ status: "SUSPENDED" }));

    await user.click(screen.getByRole("button", { name: "Change status" }));
    expect(screen.getByRole("menuitem", { name: "Reactivate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Remove" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Suspend" })).not.toBeInTheDocument();
  });

  it("shows a stronger warning when the target is the caller's own membership", async () => {
    const user = userEvent.setup();
    renderMenu(member({ userId: CURRENT_USER_ID, status: "ACTIVE" }));

    await user.click(screen.getByRole("button", { name: "Change status" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/this is your own membership/i)).toBeInTheDocument();
  });

  it("does not show the self-warning for a different user", async () => {
    const user = userEvent.setup();
    renderMenu(member({ userId: "other-user-id", status: "ACTIVE" }));

    await user.click(screen.getByRole("button", { name: "Change status" }));
    await user.click(screen.getByRole("menuitem", { name: "Suspend" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/this is your own membership/i)).not.toBeInTheDocument();
  });

  it("changes status after confirmation and shows a success notification", async () => {
    const user = userEvent.setup();
    const fetchMock = renderMenu(member({ status: "ACTIVE" }), async (url, init) => {
      if (typeof url === "string" && url.includes("/members/other-user-id") && init?.method === "PATCH") {
        return jsonResponse(200, member({ status: "SUSPENDED" }));
      }
      return jsonResponse(200, null);
    });

    await user.click(screen.getByRole("button", { name: "Change status" }));
    await user.click(screen.getByRole("menuitem", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Suspend" }));

    expect(await screen.findByText(/is now suspended/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/organizations/org-1/members/other-user-id",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  // The backend enforces no membership-status transition rules at all —
  // a 404 here means the membership itself is gone (e.g. removed by
  // another admin between page load and this click), not an invalid
  // transition, and must surface as such.
  it("surfaces MEMBERSHIP_NOT_FOUND when the membership was removed by someone else first", async () => {
    const user = userEvent.setup();
    renderMenu(member({ status: "ACTIVE" }), async (url, init) => {
      if (typeof url === "string" && url.includes("/members/") && init?.method === "PATCH") {
        return jsonResponse(404, null, "No membership found for this user in organization org-1");
      }
      return jsonResponse(200, null);
    });

    await user.click(screen.getByRole("button", { name: "Change status" }));
    await user.click(screen.getByRole("menuitem", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Suspend" }));

    expect(await screen.findByText("No membership found for this user in organization org-1")).toBeInTheDocument();
  });
});
