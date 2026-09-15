import type { PaletteOptions } from "@mui/material/styles";

import { blue, brand, neutral, red } from "../tokens/colors";
import { buildStatusPalette } from "./statusPalette";

export const darkPalette: PaletteOptions = {
  mode: "dark",
  primary: {
    main: brand[400],
    light: brand[300],
    dark: brand[600],
    contrastText: neutral[950],
  },
  secondary: {
    main: neutral[300],
    light: neutral[200],
    dark: neutral[500],
    contrastText: neutral[950],
  },
  success: { main: "#32D583", contrastText: neutral[950] },
  warning: { main: "#FDB022", contrastText: neutral[950] },
  error: { main: red[400], contrastText: neutral[950] },
  info: { main: blue[400], contrastText: neutral[950] },
  background: {
    default: neutral[950],
    paper: neutral[900],
  },
  text: {
    primary: neutral[50],
    secondary: neutral[400],
    disabled: neutral[600],
  },
  divider: neutral[800],
  action: {
    hover: neutral[800],
    selected: brand[900],
    disabled: neutral[700],
    disabledBackground: neutral[800],
    focus: brand[700],
  },
  status: buildStatusPalette("dark"),
};
