import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Rendered next to the title — typically a StatusBadge. */
  status?: ReactNode;
  /** Primary/secondary action buttons, right-aligned. */
  actions?: ReactNode;
  onBack?: () => void;
}

/** Standard title bar for every page — see design-system/patterns for the full page layout it composes into. */
export function PageHeader({ title, description, status, actions, onBack }: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      justifyContent="space-between"
      alignItems={{ xs: "flex-start", sm: "center" }}
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        {onBack && (
          <IconButton onClick={onBack} aria-label="Go back" size="small" sx={{ mt: 0.25 }}>
            <ArrowBackOutlinedIcon fontSize="small" />
          </IconButton>
        )}
        <Stack spacing={0.5}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="h3" component="h1">
              {title}
            </Typography>
            {status}
          </Stack>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Stack>
      </Stack>
      {actions && (
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
