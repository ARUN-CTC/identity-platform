import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useId, type ReactNode } from "react";

export interface FormDrawerProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  submitting?: boolean;
  /** Disables the submit button, e.g. while the form is invalid. */
  submitDisabled?: boolean;
  width?: number;
  children: ReactNode;
}

/**
 * The create/edit drawer used across every master-data screen (see
 * design-system/patterns/create-edit). Owns layout/chrome only — form
 * state, validation and submission stay in the calling page.
 */
export function FormDrawer({
  open,
  title,
  description,
  onClose,
  onSubmit,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  submitting = false,
  submitDisabled = false,
  width = 480,
  children,
}: FormDrawerProps) {
  const titleId = useId();

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { "aria-labelledby": titleId } }}
      sx={{ "& .MuiDrawer-paper": { width: { xs: "100%", sm: width }, boxSizing: "border-box" } }}
    >
      <Stack sx={{ height: "100%" }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ p: 2.5 }}>
          <Box>
            <Typography id={titleId} variant="h4" component="h2">
              {title}
            </Typography>
            {description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {description}
              </Typography>
            )}
          </Box>
          <IconButton onClick={onClose} aria-label="Close" size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Divider />

        <Box sx={{ flex: 1, overflowY: "auto", p: 2.5 }}>{children}</Box>

        {onSubmit && (
          <>
            <Divider />
            <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ p: 2.5 }}>
              <Button onClick={onClose} color="inherit" disabled={submitting}>
                {cancelLabel}
              </Button>
              <Button onClick={onSubmit} variant="contained" loading={submitting} disabled={submitDisabled}>
                {submitLabel}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Drawer>
  );
}
