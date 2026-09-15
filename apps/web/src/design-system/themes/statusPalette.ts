import { alpha } from "@mui/material/styles";

import { statusColorTokens } from "../tokens/status";
import type { StatusPalette } from "./augmentation";

/**
 * Derives the tinted-background / solid-text pair StatusBadge needs from a
 * single base color per status, so light and dark mode stay visually
 * consistent without hand-tuning every status twice.
 */
export function buildStatusPalette(mode: "light" | "dark"): StatusPalette {
  const bgAlpha = mode === "light" ? 0.12 : 0.24;
  const entries = Object.entries(statusColorTokens).map(([key, color]) => [
    key,
    {
      main: color,
      bg: alpha(color, bgAlpha),
      contrastText: color,
    },
  ]);
  return Object.fromEntries(entries) as StatusPalette;
}
