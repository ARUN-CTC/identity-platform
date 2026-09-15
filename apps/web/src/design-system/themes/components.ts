import type { Components, Theme } from "@mui/material/styles";
// Side-effect import: augments `Components<Theme>` with the `MuiDataGrid`
// key. Without this, `theme.components.MuiDataGrid` below doesn't typecheck.
import type {} from "@mui/x-data-grid/themeAugmentation";

import { radius } from "../tokens/radius";

/**
 * Enterprise-flat MUI overrides: borders over shadows, no uppercase
 * button text, modest radii, denser table rows. Centralizing this here
 * means individual components never hand-roll their own MUI style
 * overrides (see design-system §28/§29 in the architecture doc).
 */
export function getComponentOverrides(theme: Theme): Components<Theme> {
  return {
    MuiCssBaseline: {
      styleOverrides: {
        "*": {
          scrollbarWidth: "thin",
        },
        "*::-webkit-scrollbar": {
          width: 8,
          height: 8,
        },
        "*::-webkit-scrollbar-thumb": {
          backgroundColor: theme.palette.divider,
          borderRadius: radius.full,
        },
        "*::-webkit-scrollbar-track": {
          backgroundColor: "transparent",
        },
        ":focus-visible": {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.001ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.001ms !important",
            scrollBehavior: "auto !important",
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: radius.md,
          paddingInline: theme.spacing(2),
        },
        sizeSmall: { paddingBlock: 4 },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: radius.md },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
        outlined: {
          borderColor: theme.palette.divider,
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0, variant: "outlined" },
      styleOverrides: {
        root: {
          borderRadius: radius.lg,
          borderColor: theme.palette.divider,
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: "inherit" },
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${theme.palette.divider}`,
          backgroundColor: theme.palette.background.paper,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundImage: "none",
          borderRight: `1px solid ${theme.palette.divider}`,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: radius.sm, fontWeight: 600 },
        sizeSmall: { fontSize: "0.6875rem" },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottomColor: theme.palette.divider,
          paddingBlock: theme.spacing(1.25),
        },
        head: {
          fontSize: "0.75rem",
          fontWeight: 600,
          letterSpacing: "0.02em",
          color: theme.palette.text.secondary,
          backgroundColor: theme.palette.background.default,
        },
      },
    },
    // Community DataGrid doesn't use MuiTableCell (it's not a <Table>), so
    // it needs its own override to consume the tableHeader/tableBody
    // typography tokens and stay visually consistent with plain tables.
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: "none",
          "--DataGrid-rowBorderColor": theme.palette.divider,
        },
        columnHeaders: {
          backgroundColor: theme.palette.background.default,
          borderBottom: `1px solid ${theme.palette.divider}`,
        },
        columnHeaderTitle: {
          fontSize: theme.typography.tableHeader.fontSize,
          fontWeight: theme.typography.tableHeader.fontWeight,
          letterSpacing: theme.typography.tableHeader.letterSpacing,
          color: theme.palette.text.secondary,
        },
        cell: {
          fontSize: theme.typography.tableBody.fontSize,
          borderBottom: `1px solid ${theme.palette.divider}`,
          // Deliberately no focus-ring override here: DataGrid's own default
          // (an inset outline using theme.palette.primary.main) is already
          // theme-aware and accessible. An earlier version of DataTable.tsx
          // suppressed it with `outline: none` and no replacement, which
          // broke keyboard-navigation visibility — see git history. Leave
          // this alone rather than re-fighting a default that already works.
        },
        row: {
          "&:hover": { backgroundColor: theme.palette.action.hover },
        },
        footerContainer: {
          borderTop: `1px solid ${theme.palette.divider}`,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 40 },
        indicator: { height: 2, borderRadius: radius.full },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          minHeight: 40,
          fontWeight: 600,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: radius.md },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: "0.75rem",
          borderRadius: radius.sm,
          backgroundColor: theme.palette.mode === "light" ? theme.palette.grey[900] : theme.palette.grey[700],
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: radius.md,
          border: `1px solid ${theme.palette.divider}`,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: radius.lg },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: radius.md },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: radius.full, height: 6 },
      },
    },
  };
}
