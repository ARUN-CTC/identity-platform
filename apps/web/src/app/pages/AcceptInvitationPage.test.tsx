import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureApiClient } from "@/shared/api";

import AcceptInvitationPage from "./AcceptInvitationPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  // Real backend shape (confirmed live, 2026-09-16): a success response IS
  // the resource directly; a failure is NestJS's own default
  // {statusCode, message} shape — there is no envelope (see
  // shared/api/client.ts's NestErrorBody doc comment).
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function renderPage(initialEntry: string, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe("AcceptInvitationPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an 'invalid link' message when the URL has no token, before ever calling the backend", async () => {
    const fetchMock = renderPage("/accept-invitation", async () => {
      throw new Error("should never fetch without a token");
    });

    expect(await screen.findByRole("heading", { name: "Invalid link" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates the token on mount and shows the invitee's name once valid", async () => {
    renderPage("/accept-invitation?token=good-token", async (url) => {
      if (url.includes("/invitations/validate")) {
        expect(new URL(url).searchParams.get("token")).toBe("good-token");
        return jsonResponse(200, { valid: true, email: "new.hire@example.com", firstName: "Nova" });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    expect(await screen.findByRole("heading", { name: "Welcome, Nova" })).toBeInTheDocument();
    expect(screen.getByText(/new\.hire@example\.com/)).toBeInTheDocument();
  });

  it("shows a dead-link error state for an invalid/expired/already-used token, never a password form", async () => {
    renderPage("/accept-invitation?token=dead-token", async (url) => {
      if (url.includes("/invitations/validate")) {
        return jsonResponse(400, null, "This invitation link is invalid or has expired");
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    expect(await screen.findByText("This invitation link is invalid or has expired")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
  });

  it("submits the new password against the accept endpoint and shows a success state", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage("/accept-invitation?token=good-token", async (url, init) => {
      if (url.includes("/invitations/validate")) {
        return jsonResponse(200, { valid: true, email: "new.hire@example.com", firstName: "Nova" });
      }
      if (url.includes("/invitations/accept")) {
        const body = JSON.parse(init!.body as string);
        expect(body).toEqual({ token: "good-token", password: "Str0ngPassw0rd!" });
        return jsonResponse(200, null);
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    await screen.findByRole("heading", { name: "Welcome, Nova" });
    await user.type(screen.getByLabelText(/^Password/), "Str0ngPassw0rd!");
    await user.type(screen.getByLabelText("Confirm password", { exact: false }), "Str0ngPassw0rd!");
    await user.click(screen.getByRole("button", { name: "Activate account" }));

    expect(await screen.findByRole("heading", { name: "You're all set" })).toBeInTheDocument();
    const acceptCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes("/invitations/accept"));
    expect(acceptCall).toBeDefined();
  });

  it("rejects mismatched passwords client-side without ever calling accept", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage("/accept-invitation?token=good-token", async (url) => {
      if (url.includes("/invitations/validate")) {
        return jsonResponse(200, { valid: true, email: "new.hire@example.com", firstName: "Nova" });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    await screen.findByRole("heading", { name: "Welcome, Nova" });
    await user.type(screen.getByLabelText(/^Password/), "Str0ngPassw0rd!");
    await user.type(screen.getByLabelText("Confirm password", { exact: false }), "SomethingElse!");
    await user.click(screen.getByRole("button", { name: "Activate account" }));

    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/invitations/accept"))).toBe(false);
  });

  it("surfaces the backend's error message on a failed accept without losing the form", async () => {
    const user = userEvent.setup();
    renderPage("/accept-invitation?token=good-token", async (url) => {
      if (url.includes("/invitations/validate")) {
        return jsonResponse(200, { valid: true, email: "new.hire@example.com", firstName: "Nova" });
      }
      if (url.includes("/invitations/accept")) {
        return jsonResponse(400, null, "This invitation link is invalid or has expired");
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    await screen.findByRole("heading", { name: "Welcome, Nova" });
    await user.type(screen.getByLabelText(/^Password/), "Str0ngPassw0rd!");
    await user.type(screen.getByLabelText("Confirm password", { exact: false }), "Str0ngPassw0rd!");
    await user.click(screen.getByRole("button", { name: "Activate account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This invitation link is invalid or has expired");
    // Still on the form, not the success state.
    expect(screen.getByRole("button", { name: "Activate account" })).toBeInTheDocument();
  });
});
