import TextField from "@mui/material/TextField";
import { describe, it } from "vitest";

import { expectNoA11yViolations } from "@/test/a11y";
import { renderWithProviders } from "@/test/render-with-providers";

import { FormDrawer } from "./FormDrawer";

describe("FormDrawer a11y", () => {
  it("has no violations while open", async () => {
    // Dialog/Drawer content is portaled to document.body, not the local
    // render container, so the check must run against the full document.
    renderWithProviders(
      <FormDrawer open title="New Tenant" description="Fill in the details below." onClose={() => {}} onSubmit={() => {}}>
        <TextField label="Tenant name" fullWidth />
      </FormDrawer>,
    );
    await expectNoA11yViolations(document.body);
  });
});
