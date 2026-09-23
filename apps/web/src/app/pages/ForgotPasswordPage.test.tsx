import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureApiClient } from "@/shared/api";

import ForgotPasswordPage from "./ForgotPasswordPage";

function jsonResponse(status: number, data: unknown, message = "ok") {
  const body = status < 300 ? data : { statusCode: status, message };
  return new Response(JSON.stringify(body), { status });
}

function renderPage(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  configureApiClient({ baseUrl: "http://test.local/api/v1" });
  const fetchMock = vi.fn().mockImplementation(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Tenant code/i), "ACME");
  await user.type(screen.getByLabelText(/Email/i), "someone@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
}

describe("ForgotPasswordPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the same generic confirmation whether or not the account exists — never reveals enumeration", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async (url, init) => {
      expect(new URL(url).pathname).toBe("/api/v1/auth/password/forgot");
      expect(init?.method).toBe("POST");
      return jsonResponse(200, null);
    });

    await submit(user);
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByText(/If an account matches/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error only for a genuine failure to reach the backend, not for a nonexistent account", async () => {
    const user = userEvent.setup();
    renderPage(async () => jsonResponse(500, null, "An unexpected error occurred"));

    await submit(user);
    expect(await screen.findByText("Something went wrong on our end. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("Check your email")).not.toBeInTheDocument();
  });

  it("never sends the entered email/tenant code anywhere but the one real request", async () => {
    const user = userEvent.setup();
    const fetchMock = renderPage(async () => jsonResponse(200, null));

    await submit(user);
    await screen.findByText("Check your email");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const raw = JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
    expect(raw).not.toContain("someone@example.com");
  });
});
