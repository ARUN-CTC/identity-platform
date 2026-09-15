import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export interface LoadingStateProps {
  label?: string;
  /** Tighter padding for inline/panel usage rather than full page content areas. */
  dense?: boolean;
}

/** Non-skeleton loading indicator for full sections/pages; prefer Skeleton for tables/lists. */
export function LoadingState({ label = "Loading…", dense = false }: LoadingStateProps) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      role="status"
      aria-live="polite"
      sx={{ py: dense ? 3 : 8 }}
    >
      <CircularProgress size={dense ? 24 : 32} aria-label={label} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}
