import type { CSSProperties } from "react";

import type { StatusKey } from "../tokens/status";

export interface StatusPaletteEntry {
  main: string;
  bg: string;
  contrastText: string;
}

export type StatusPalette = Record<StatusKey, StatusPaletteEntry>;

declare module "@mui/material/styles" {
  interface Palette {
    status: StatusPalette;
  }
  interface PaletteOptions {
    status?: StatusPalette;
  }

  interface TypographyVariants {
    tableHeader: CSSProperties;
    tableBody: CSSProperties;
    label: CSSProperties;
  }
  interface TypographyVariantsOptions {
    tableHeader?: CSSProperties;
    tableBody?: CSSProperties;
    label?: CSSProperties;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    tableHeader: true;
    tableBody: true;
    label: true;
  }
}
