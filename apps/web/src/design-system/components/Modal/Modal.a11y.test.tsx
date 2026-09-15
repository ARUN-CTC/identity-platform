import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { describe, it } from "vitest";

import { expectNoA11yViolations } from "@/test/a11y";
import { renderWithProviders } from "@/test/render-with-providers";

import { Modal } from "./Modal";

describe("Modal a11y", () => {
  it("has no violations while open", async () => {
    renderWithProviders(
      <Modal open title="Tenant Details" onClose={() => {}} actions={<Button>Close</Button>}>
        <Typography>Some detail content.</Typography>
      </Modal>,
    );
    await expectNoA11yViolations(document.body);
  });
});
