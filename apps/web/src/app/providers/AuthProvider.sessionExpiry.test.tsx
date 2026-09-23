import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { NotificationProvider } from "@/app/providers/NotificationProvider";
import { ThemeModeProvider } from "@/app/providers/ThemeModeProvider";
import { emitSessionExpired } from "@/shared/api";

import { AuthProvider } from "./AuthProvider";

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeModeProvider>
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <AuthProvider>
            <div>App content</div>
          </AuthProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
}

describe("AuthProvider — session expiry", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("shows the SessionExpiredDialog (not just a toast) when the session expires, and it closes on 'Sign in'", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText("App content");

    expect(screen.queryByText("Your session has expired")).not.toBeInTheDocument();

    emitSessionExpired();

    expect(await screen.findByText("Your session has expired")).toBeInTheDocument();
    expect(screen.getByText("Please sign in again to continue.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.queryByText("Your session has expired")).not.toBeInTheDocument());
  });

  it("cannot be dismissed with Escape — the only way out is the Sign in button", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText("App content");

    emitSessionExpired();
    await screen.findByText("Your session has expired");

    await user.keyboard("{Escape}");
    expect(screen.getByText("Your session has expired")).toBeInTheDocument();
  });
});
