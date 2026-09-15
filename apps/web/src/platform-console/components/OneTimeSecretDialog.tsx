import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useNotify } from "@/app/providers/NotificationProvider";

export interface OneTimeSecretDialogProps {
  open: boolean;
  onClose: () => void;
  /** e.g. "Client secret", "Service account credential". */
  label: string;
  /** e.g. the clientId or service account name, for context. */
  identity: string;
  secret: string;
}

/**
 * Security-sensitive UI, used for both a newly-created Application's
 * `clientSecret` and a newly-created ServiceAccount's `credential` — both
 * backend responses that show the plaintext value exactly once and never
 * again (neither has a rotation/revocation/re-reveal endpoint). This
 * component:
 *   - never persists the secret anywhere (it lives only in the parent's
 *     transient React state, passed down as a prop — never written to
 *     localStorage/sessionStorage/query cache)
 *   - never logs it (no console.log anywhere in this tree)
 *   - offers Clipboard-API copy with a transient confirmation, nothing else
 *   - closing this dialog is the only affordance — there is deliberately no
 *     "show again" action, because the backend has none to call
 */
export function OneTimeSecretDialog({ open, onClose, label, identity, secret }: OneTimeSecretDialogProps) {
  const notify = useNotify();
  const [revealed, setRevealed] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      notify({ message: `${label} copied to clipboard.`, severity: "success" });
    } catch {
      notify({ message: "Could not copy automatically — select and copy the value manually.", severity: "error" });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{identity} created successfully</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Alert severity="warning">This {label.toLowerCase()} will not be shown again. Copy it now and store it securely.</Alert>
          <TextField
            label={label}
            value={revealed ? secret : "•".repeat(Math.min(secret.length, 40))}
            fullWidth
            InputProps={{
              readOnly: true,
              sx: { fontFamily: "monospace" },
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setRevealed((v) => !v)} aria-label={revealed ? `Hide ${label.toLowerCase()}` : `Reveal ${label.toLowerCase()}`} size="small">
                    <Typography variant="caption">{revealed ? "Hide" : "Show"}</Typography>
                  </IconButton>
                  <IconButton onClick={handleCopy} aria-label={`Copy ${label.toLowerCase()}`} size="small">
                    <ContentCopyOutlinedIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Done — I've saved it
        </Button>
      </DialogActions>
    </Dialog>
  );
}
