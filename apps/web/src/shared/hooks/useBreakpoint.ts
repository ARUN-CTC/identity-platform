import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

/** True when viewport is below the "laptop" breakpoint (md) — the shell's mobile-nav threshold. */
export function useIsMobile(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("md"));
}

/** True when viewport is below the "desktop" breakpoint (lg) — used to auto-collapse the sidebar. */
export function useIsTablet(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("lg"));
}
