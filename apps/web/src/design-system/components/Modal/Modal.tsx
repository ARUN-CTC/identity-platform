import CloseIcon from "@mui/icons-material/Close";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import type { ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  actions?: ReactNode;
  maxWidth?: "xs" | "sm" | "md" | "lg";
  children: ReactNode;
}

/** General-purpose dialog for content that isn't a create/edit form (use FormDrawer for that) or a yes/no prompt (use ConfirmDialog). */
export function Modal({ open, title, onClose, actions, maxWidth = "sm", children }: ModalProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth aria-labelledby="modal-title">
      <DialogTitle id="modal-title" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {title}
        <IconButton onClick={onClose} aria-label="Close" size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>{children}</DialogContent>
      {actions && <DialogActions sx={{ px: 3, py: 2 }}>{actions}</DialogActions>}
    </Dialog>
  );
}
