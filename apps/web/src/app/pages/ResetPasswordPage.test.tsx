import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureApiClient } from "@/shared/api";

import ResetPasswordPage from "./ResetPasswordPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function renderPage(path: string, fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () => jsonResponse(200, null)) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/forgot-password" element={<div>Forgot password page</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe("ResetPasswordPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an invalid-link state and makes no backend call when the token is missing", async () => {
    const fetchMock = renderPage("/reset-password");
    expect(await screen.findByText("Invalid link")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks submission client-side when the passwords don't match, without calling the backend", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage("/reset-password?token=abc123");

    await user.type(screen.getByLabelText(/^New password/i), "correct-horse-1");
    await user.type(screen.getByLabelText(/Confirm new password/i), "different-password");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText(/don't match/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the token from the URL and the new password, and shows a success state that never auto-logs-in", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage("/reset-password?token=abc123", async (url, init) => {
      expect(new URL(url).pathname).toBe("/api/v1/auth/password/reset");
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ token: "abc123", newPassword: "correct-horse-1" });
      return jsonResponse(200, null);
    });

    await user.type(screen.getByLabelText(/^New password/i), "correct-horse-1");
    await user.type(screen.getByLabelText(/Confirm new password/i), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password reset")).toBeInTheDocument();
    expect(screen.getByText(/signed out everywhere else/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No auto-login — only a link/button back to /login, no tokens issued here.
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("surfaces an invalid/expired token error from the backend without losing the form", async () => {
    const user = userEvent.setup();
    renderPage("/reset-password?token=expired-token", async () => jsonResponse(400, null, "This reset link is invalid or has expired"));

    await user.type(screen.getByLabelText(/^New password/i), "correct-horse-1");
    await user.type(screen.getByLabelText(/Confirm new password/i), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("This reset link is invalid or has expired")).toBeInTheDocument();
    expect(screen.getByLabelText(/^New password/i)).toBeInTheDocument();
  });

  it("never persists the new password anywhere in browser storage", async () => {
    const user = userEvent.setup();
    renderPage("/reset-password?token=abc123");

    await user.type(screen.getByLabelText(/^New password/i), "correct-horse-1");
    await user.type(screen.getByLabelText(/Confirm new password/i), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await screen.findByText("Password reset");

    const raw = JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
    expect(raw).not.toContain("correct-horse-1");
  });
});
