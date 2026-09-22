import ConstructionOutlinedIcon from "@mui/icons-material/ConstructionOutlined";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import SearchOffOutlinedIcon from "@mui/icons-material/SearchOffOutlined";
import WifiOffOutlinedIcon from "@mui/icons-material/WifiOffOutlined";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

export type EmptyStateVariant = "no-data" | "no-results" | "permission-denied" | "not-found" | "network-error" | "not-available";

const VARIANT_ICON: Record<EmptyStateVariant, typeof InboxOutlinedIcon> = {
  "no-data": InboxOutlinedIcon,
  "no-results": SearchOffOutlinedIcon,
  "permission-denied": LockOutlinedIcon,
  "not-found": ReportProblemOutlinedIcon,
  "network-error": WifiOffOutlinedIcon,
  // Phase 2UI.3 — a capability with no backing API yet (not "zero rows
  // today," a genuinely different state: this platform doesn't yet expose
  // an endpoint for it at all). Distinct from "no-data" on purpose — see
  // docs/IDENTITY_UX_GAP_ANALYSIS.md and docs/PHASE_2UI3.md's own API Gap
  // table for what this covers and why each was left undone this phase.
  "not-available": ConstructionOutlinedIcon,
};

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Tighter padding for use inside menus/panels rather than full page content areas. */
  dense?: boolean;
}

/**
 * The single source of empty/no-results/permission-denied/not-found UI.
 * Domain pages should always reach for this rather than inventing their
 * own "nothing here" markup — see design-system/patterns/empty-state.
 */
export function EmptyState({ variant = "no-data", title, description, action, dense = false }: EmptyStateProps) {
  const Icon = VARIANT_ICON[variant];

  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      role={variant === "permission-denied" ? "alert" : undefined}
      sx={{
        textAlign: "center",
        py: dense ? 2 : 8,
        px: 3,
        color: "text.secondary",
      }}
    >
      <Box
        sx={{
          width: dense ? 40 : 56,
          height: dense ? 40 : 56,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "action.hover",
          color: "text.disabled",
        }}
      >
        <Icon fontSize={dense ? "small" : "medium"} />
      </Box>
      <Box>
        <Typography variant={dense ? "body2" : "h5"} color="text.primary" fontWeight={600}>
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 400 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  );
}
