import { describe, expect, it } from "vitest";

import { breakpoints, muiBreakpointValues } from "./breakpoints";
import { ALL_STATUS_KEYS } from "@/design-system/patterns/status";
import { statusColorTokens } from "./status";

describe("design tokens", () => {
  it("maps every named breakpoint onto MUI's breakpoint values", () => {
    expect(muiBreakpointValues).toEqual({
      xs: breakpoints.mobile,
      sm: breakpoints.tablet,
      md: breakpoints.laptop,
      lg: breakpoints.desktop,
      xl: breakpoints.largeDesktop,
    });
  });

  it("defines every status from the spec's lifecycle list", () => {
    const expectedStatuses = [
      "draft",
      "pending",
      "active",
      "inactive",
      "suspended",
      "approved",
      "rejected",
      "failed",
      "completed",
      "cancelled",
      "archived",
    ];
    for (const status of expectedStatuses) {
      expect(statusColorTokens).toHaveProperty(status);
    }
  });

  it("gives every status a valid hex color", () => {
    for (const key of ALL_STATUS_KEYS) {
      expect(statusColorTokens[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
