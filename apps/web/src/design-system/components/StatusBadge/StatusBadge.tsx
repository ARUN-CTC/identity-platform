import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";

import type { StatusKey } from "@/design-system/tokens/status";

export interface StatusBadgeProps {
  status: StatusKey;
  /** Overrides the default title-cased status key (e.g. "Pending Review" instead of "Pending"). */
  label?: string;
  size?: "small" | "medium";
}

/** Title-cases a StatusKey for display when no explicit `label` is given — handles camelCase keys (e.g. "inProgress" → "In Progress"), not just simple lowercase ones. */
function defaultLabel(status: StatusKey): string {
  const spaced = status.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The single way to render entity lifecycle state across every domain.
 * Color alone never carries the meaning — the label is always present,
 * and a colored dot supplements the tinted background for colorblind users.
 */
export function StatusBadge({ status, label, size = "small" }: StatusBadgeProps) {
  const theme = useTheme();
  const palette = theme.palette.status[status];

  return (
    <Chip
      size={size}
      label={label ?? defaultLabel(status)}
      icon={
        <Box
          component="span"
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: palette.main,
            ml: "8px !important",
          }}
        />
      }
      sx={{
        bgcolor: palette.bg,
        color: palette.contrastText,
        "& .MuiChip-icon": { color: palette.main },
      }}
    />
  );
}
