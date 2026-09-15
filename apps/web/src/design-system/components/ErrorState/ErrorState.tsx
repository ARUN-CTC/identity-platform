import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  dense?: boolean;
}

/** Server/network error UI for a section or page — pairs with react-query's `error` state. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this data. Please try again.",
  onRetry,
  dense = false,
}: ErrorStateProps) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      role="alert"
      sx={{ textAlign: "center", py: dense ? 3 : 8, px: 3 }}
    >
      <ErrorOutlineOutlinedIcon color="error" fontSize={dense ? "medium" : "large"} />
      <Typography variant={dense ? "body2" : "h5"} fontWeight={600}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 400 }}>
        {description}
      </Typography>
      {onRetry && (
        <Button variant="outlined" size="small" onClick={onRetry} sx={{ mt: 1 }}>
          Retry
        </Button>
      )}
    </Stack>
  );
}
