import { createTheme, responsiveFontSizes, type Theme, type TypographyVariantsOptions } from "@mui/material/styles";

import { muiBreakpointValues } from "../tokens/breakpoints";
import { radius } from "../tokens/radius";
import { fontFamily, fontWeight, typeScale } from "../tokens/typography";
import { darkPalette } from "./dark";
import { getComponentOverrides } from "./components";
import { lightPalette } from "./light";

export type ThemeMode = "light" | "dark";

const typography = {
  fontFamily: fontFamily.base,
  fontWeightRegular: fontWeight.regular,
  fontWeightMedium: fontWeight.medium,
  fontWeightBold: fontWeight.bold,
  h1: typeScale.h1,
  h2: typeScale.h2,
  h3: typeScale.h3,
  h4: typeScale.h4,
  h5: typeScale.h5,
  h6: typeScale.h5,
  subtitle1: typeScale.bodyLarge,
  subtitle2: typeScale.body,
  body1: typeScale.body,
  body2: typeScale.bodySmall,
  caption: typeScale.caption,
  overline: { ...typeScale.label, textTransform: "uppercase" as const },
  button: { ...typeScale.body, fontWeight: fontWeight.semibold, textTransform: "none" as const },
  tableHeader: typeScale.tableHeader,
  tableBody: typeScale.tableBody,
  label: typeScale.label,
} as TypographyVariantsOptions;

function buildTheme(mode: ThemeMode): Theme {
  const base = createTheme({
    palette: mode === "light" ? lightPalette : darkPalette,
    typography,
    shape: { borderRadius: radius.md },
    breakpoints: { values: muiBreakpointValues },
    spacing: 8,
    // MUI's default zIndex.drawer (1200) > zIndex.appBar (1100) is kept as-is:
    // it's what makes temporary Drawers (FormDrawer, MobileNav) render above
    // the sticky Topbar. An earlier version of this file inverted the two —
    // see tokens/zIndex.ts for the shell-layer tokens that don't touch this.
  });

  const withComponents = createTheme(base, {
    components: getComponentOverrides(base),
  });

  return responsiveFontSizes(withComponents, { breakpoints: ["sm", "md"] });
}

export const lightTheme = buildTheme("light");
export const darkTheme = buildTheme("dark");

export function getTheme(mode: ThemeMode): Theme {
  return mode === "light" ? lightTheme : darkTheme;
}

export type { StatusPalette, StatusPaletteEntry } from "./augmentation";
