import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";

export interface SessionExpiredDialogProps {
  open: boolean;
  onSignIn: () => void;
}

/**
 * The one consistent "your session ended" experience (brief §15/§22) —
 * replaces a bare toast with a real, unmissable, non-dismissable-by-accident
 * modal. Deliberately has no close/cancel action: `AuthProvider` only opens
 * this after it has already cleared all authenticated state, so there is
 * nothing left to "cancel" back into — the only way forward is signing in
 * again. `onSignIn` is a plain navigation, not a retry of whatever failed.
 */
export function SessionExpiredDialog({ open, onSignIn }: SessionExpiredDialogProps) {
  return (
    <Dialog open={open} maxWidth="xs" fullWidth aria-labelledby="session-expired-title" disableEscapeKeyDown>
      <DialogTitle id="session-expired-title">Your session has expired</DialogTitle>
      <DialogContent>
        <DialogContentText>Please sign in again to continue.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onSignIn}>
          Sign in
        </Button>
      </DialogActions>
    </Dialog>
  );
}
