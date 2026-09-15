import type { PaletteOptions } from "@mui/material/styles";

import { blue, brand, neutral, red } from "../tokens/colors";
import { buildStatusPalette } from "./statusPalette";

export const lightPalette: PaletteOptions = {
  mode: "light",
  primary: {
    main: brand[600],
    light: brand[400],
    dark: brand[800],
    contrastText: neutral[0],
  },
  secondary: {
    main: neutral[700],
    light: neutral[500],
    dark: neutral[900],
    contrastText: neutral[0],
  },
  success: { main: "#12B76A", contrastText: neutral[0] },
  warning: { main: "#F79009", contrastText: neutral[900] },
  error: { main: red[600], contrastText: neutral[0] },
  info: { main: blue[600], contrastText: neutral[0] },
  background: {
    default: neutral[50],
    paper: neutral[0],
  },
  text: {
    primary: neutral[900],
    secondary: neutral[600],
    disabled: neutral[400],
  },
  divider: neutral[200],
  action: {
    hover: neutral[100],
    selected: brand[50],
    disabled: neutral[300],
    disabledBackground: neutral[100],
    focus: brand[200],
  },
  status: buildStatusPalette("light"),
};
