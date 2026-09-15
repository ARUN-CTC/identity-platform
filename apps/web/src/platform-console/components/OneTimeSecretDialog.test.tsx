import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/app/providers/NotificationProvider";

import { OneTimeSecretDialog } from "./OneTimeSecretDialog";

const SECRET = "sk_live_super_secret_value_123456";

function renderDialog() {
  return render(
    <NotificationProvider>
      <OneTimeSecretDialog open onClose={() => {}} label="Client secret" identity="TravelOS Web" secret={SECRET} />
    </NotificationProvider>,
  );
}

describe("OneTimeSecretDialog", () => {
  it("masks the secret by default — the raw value never appears in the DOM until revealed", () => {
    renderDialog();
    expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Client secret")).toHaveValue("•".repeat(SECRET.length));
  });

  it("reveals the secret only after an explicit click, and can be hidden again", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Reveal client secret" }));
    expect(screen.getByLabelText("Client secret")).toHaveValue(SECRET);

    await user.click(screen.getByRole("button", { name: "Hide client secret" }));
    expect(screen.getByLabelText("Client secret")).not.toHaveValue(SECRET);
  });

  it("copies the exact secret value via the Clipboard API and shows a confirmation, without ever logging it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const consoleSpy = vi.spyOn(console, "log");

    renderDialog();
    // fireEvent, not userEvent, for this one click — MUI's IconButton ripple
    // + userEvent's realistic pointer-event sequence don't reliably reach
    // this async handler in jsdom (verified: fireEvent.click does; every
    // other interaction in this suite uses the real userEvent.click).
    fireEvent.click(screen.getByRole("button", { name: "Copy client secret" }));

    await screen.findByText("Client secret copied to clipboard.");
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining(SECRET));
    consoleSpy.mockRestore();
  });

  it("the input is read-only — there is no path for a user to accidentally edit or resubmit the secret", () => {
    renderDialog();
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("readonly");
  });
});
