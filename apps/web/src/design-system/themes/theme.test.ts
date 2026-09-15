import { describe, expect, it } from "vitest";

import { statusColorTokens } from "../tokens/status";
import { darkTheme, getTheme, lightTheme } from "./index";

describe("themes", () => {
  it("builds distinct light and dark palettes", () => {
    expect(lightTheme.palette.mode).toBe("light");
    expect(darkTheme.palette.mode).toBe("dark");
    expect(lightTheme.palette.background.default).not.toBe(darkTheme.palette.background.default);
  });

  it("resolves getTheme() to the matching mode", () => {
    expect(getTheme("light")).toBe(lightTheme);
    expect(getTheme("dark")).toBe(darkTheme);
  });

  it("augments the palette with an entry for every status token", () => {
    for (const key of Object.keys(statusColorTokens)) {
      expect(lightTheme.palette.status).toHaveProperty(key);
      expect(darkTheme.palette.status).toHaveProperty(key);
    }
  });

  it("registers the custom table/label typography variants", () => {
    expect(lightTheme.typography.tableHeader).toBeDefined();
    expect(lightTheme.typography.tableBody).toBeDefined();
    expect(lightTheme.typography.label).toBeDefined();
  });
});
