import type { CSSProperties } from "react";

/**
 * Typography scale tuned for data-dense enterprise screens rather than
 * marketing pages — the display/H1 sizes are deliberately modest.
 */

export const fontFamily = {
  base: '"Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const typeScale: Record<string, CSSProperties> = {
  display: { fontSize: "2.25rem", lineHeight: 1.2, fontWeight: fontWeight.semibold },
  h1: { fontSize: "1.75rem", lineHeight: 1.25, fontWeight: fontWeight.semibold },
  h2: { fontSize: "1.5rem", lineHeight: 1.3, fontWeight: fontWeight.semibold },
  h3: { fontSize: "1.25rem", lineHeight: 1.35, fontWeight: fontWeight.semibold },
  h4: { fontSize: "1.125rem", lineHeight: 1.4, fontWeight: fontWeight.semibold },
  h5: { fontSize: "1rem", lineHeight: 1.4, fontWeight: fontWeight.semibold },
  bodyLarge: { fontSize: "1rem", lineHeight: 1.5, fontWeight: fontWeight.regular },
  body: { fontSize: "0.875rem", lineHeight: 1.5, fontWeight: fontWeight.regular },
  bodySmall: { fontSize: "0.8125rem", lineHeight: 1.45, fontWeight: fontWeight.regular },
  caption: { fontSize: "0.75rem", lineHeight: 1.4, fontWeight: fontWeight.regular },
  label: {
    fontSize: "0.75rem",
    lineHeight: 1.3,
    fontWeight: fontWeight.medium,
    letterSpacing: "0.02em",
  },
  tableHeader: {
    fontSize: "0.75rem",
    lineHeight: 1.3,
    fontWeight: fontWeight.semibold,
    letterSpacing: "0.02em",
  },
  tableBody: { fontSize: "0.8125rem", lineHeight: 1.4, fontWeight: fontWeight.regular },
} as const;

export const typographyTokens = { fontFamily, fontWeight, typeScale } as const;
