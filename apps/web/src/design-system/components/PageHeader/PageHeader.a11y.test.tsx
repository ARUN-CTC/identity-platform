import Button from "@mui/material/Button";
import { describe, it } from "vitest";

import { expectNoA11yViolations } from "@/test/a11y";
import { renderWithProviders } from "@/test/render-with-providers";

import { PageHeader } from "./PageHeader";
import { StatusBadge } from "../StatusBadge";

describe("PageHeader a11y", () => {
  it("has no violations with title, status, description, and actions", async () => {
    const { container } = renderWithProviders(
      <PageHeader
        title="Tenant Management"
        description="Manage every tenant provisioned on this TravelOS instance."
        status={<StatusBadge status="active" />}
        actions={<Button variant="contained">New Tenant</Button>}
        onBack={() => {}}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
