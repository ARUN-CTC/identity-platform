import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { configureApiClient } from "@/shared/api";

import SecurityAuditPage from "./SecurityAuditPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource/list directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function renderPage(fetchImpl: (url: string) => Promise<Response>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <SecurityAuditPage />
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
  return fetchMock;
}

const sampleEvent = {
  id: "evt-1",
  tenantId: "t1",
  actorUserId: "user-1",
  scope: "TENANT",
  eventType: "iam.role_granted",
  resourceType: "SecurityUser",
  resourceId: "user-2",
  metadata: { roleCode: "BILLING_MANAGER", organizationId: null, password: "should-never-render" },
  ipAddress: "203.0.113.5",
  userAgent: "Mozilla/5.0",
  correlationId: "corr-abc-123",
  createdAt: "2026-01-01T10:00:00.000Z",
};

describe("SecurityAuditPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and displays security events, with a friendly event label", async () => {
    renderPage(async (url) => {
      if (typeof url === "string" && new URL(url).pathname.endsWith("/security-audit/events")) {
        return jsonResponse(200, { items: [sampleEvent], meta: { page: 1, limit: 25, total: 1, totalPages: 1 } });
      }
      return jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } });
    });

    expect(await screen.findByText("Role granted")).toBeInTheDocument();
  });

  it("shows an empty state when there are no events", async () => {
    renderPage(async () => jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } }));

    expect(await screen.findByText("No security events found")).toBeInTheDocument();
  });

  it("shows an error state when the events request fails, without exposing internal details", async () => {
    renderPage(async (url) => {
      if (typeof url === "string" && new URL(url).pathname.endsWith("/security-audit/events")) {
        return jsonResponse(500, null, "An unexpected error occurred");
      }
      return jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } });
    });

    expect(await screen.findByText("Something went wrong on our end. Please try again.")).toBeInTheDocument();
  });

  it("sends the exact eventType selected in the filter — this is an exact-match param, not a search", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async () => jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } }));

    await screen.findByText("No security events found");
    // MUI's Select opens on mousedown of its visible display element, not
    // a full click sequence on the aria-labelled root — target the
    // rendered "All event types" text directly, the actual clickable node.
    fireEvent.mouseDown(screen.getByText("All event types"));
    await user.click(await screen.findByRole("option", { name: "Role granted" }));

    const lastEventsCall = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => new URL(u).pathname.endsWith("/security-audit/events")).pop()!;
    expect(new URL(lastEventsCall).searchParams.get("eventType")).toBe("iam.role_granted");
  });

  it("opens the event detail from a row and masks a hypothetical sensitive metadata key while showing safe fields and the correlation ID", async () => {
    const user = userEvent.setup();
    renderPage(async (url) => {
      if (typeof url === "string" && new URL(url).pathname.endsWith("/security-audit/events")) {
        return jsonResponse(200, { items: [sampleEvent], meta: { page: 1, limit: 25, total: 1, totalPages: 1 } });
      }
      return jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } });
    });

    await user.click(await screen.findByText("Role granted"));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("corr-abc-123")).toBeInTheDocument();
    expect(within(dialog).getByText(/BILLING_MANAGER/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/should-never-render/)).not.toBeInTheDocument();
  });

  it("switches to Login Attempts and searches by identifier, and shows Failed for an unsuccessful attempt", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async (url) => {
      const pathname = new URL(url as string).pathname;
      if (pathname.endsWith("/security-audit/login-attempts")) {
        return jsonResponse(200, {
          items: [
            {
              id: "la-1",
              tenantId: "t1",
              userId: null,
              identifier: "jane@acme.com",
              success: false,
              failureReason: "INVALID_PASSWORD",
              ipAddress: "203.0.113.9",
              createdAt: "2026-01-01T09:00:00.000Z",
            },
          ],
          meta: { page: 1, limit: 25, total: 1, totalPages: 1 },
        });
      }
      return jsonResponse(200, { items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } });
    });

    await user.click(screen.getByRole("tab", { name: "Login Attempts" }));
    expect(await screen.findByText("jane@acme.com")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("INVALID_PASSWORD")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search by email or tenant code…"), "jane");
    await vi.waitFor(() => {
      const lastCall = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => new URL(u).pathname.endsWith("/login-attempts")).pop()!;
      expect(new URL(lastCall).searchParams.get("identifier")).toBe("jane");
    });
  });
});
