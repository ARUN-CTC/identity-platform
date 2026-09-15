import { describe, it } from "vitest";

import { expectNoA11yViolations } from "@/test/a11y";
import { renderWithProviders } from "@/test/render-with-providers";

import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog a11y", () => {
  it("has no violations while open (non-destructive)", async () => {
    renderWithProviders(
      <ConfirmDialog
        open
        title="Activate this tenant?"
        description="It will become accessible to its users."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await expectNoA11yViolations(document.body);
  });

  it("has no violations while open (destructive)", async () => {
    renderWithProviders(
      <ConfirmDialog
        open
        title="Delete this tenant?"
        description="This cannot be undone."
        destructive
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await expectNoA11yViolations(document.body);
  });
});
