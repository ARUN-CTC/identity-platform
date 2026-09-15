import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import Grid from "@mui/material/Grid";
import InputLabel from "@mui/material/InputLabel";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useNotify } from "@/app/providers/NotificationProvider";
import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { getApiErrorMessage } from "@/shared/api";
import type { ApplicationStatus, CreatedServiceAccount } from "@/shared/platform-api";

import { OneTimeSecretDialog } from "../../../components/OneTimeSecretDialog";
import { useCreateServiceAccountMutation, useServiceAccountsForApplicationQuery, useUpdateServiceAccountMutation } from "../../service-accounts/hooks";
import { usePlatformApplicationQuery, useUpdateApplicationMutation } from "../hooks";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
        {value}
      </Typography>
    </Grid>
  );
}

export default function PlatformApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const [createSaOpen, setCreateSaOpen] = useState(false);
  const [saName, setSaName] = useState("");
  const [revealedCredential, setRevealedCredential] = useState<CreatedServiceAccount | null>(null);

  const applicationQuery = usePlatformApplicationQuery(id);
  const updateAppMutation = useUpdateApplicationMutation(id ?? "", applicationQuery.data?.productId ?? "");
  const serviceAccountsQuery = useServiceAccountsForApplicationQuery(id);
  const createSaMutation = useCreateServiceAccountMutation(id ?? "");
  const updateSaMutation = useUpdateServiceAccountMutation(id ?? "");

  if (applicationQuery.isLoading) return <LoadingState label="Loading application…" />;
  if (applicationQuery.isError) {
    return <ErrorState title="Unable to load this application" description={getApiErrorMessage(applicationQuery.error)} onRetry={() => applicationQuery.refetch()} />;
  }
  const application = applicationQuery.data!;

  const handleStatusChange = async (status: ApplicationStatus) => {
    try {
      await updateAppMutation.mutateAsync({ status });
      notify({ message: `${application.name} is now ${status}.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleCreateServiceAccount = async () => {
    if (!saName.trim()) return;
    try {
      const created = await createSaMutation.mutateAsync(saName.trim());
      setCreateSaOpen(false);
      setSaName("");
      setRevealedCredential(created);
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleToggleServiceAccountStatus = async (saId: string, currentStatus: string) => {
    try {
      await updateSaMutation.mutateAsync({ id: saId, status: currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE" });
      notify({ message: "Service account status updated.", severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  return (
    <>
      <PageHeader title={application.name} description={application.clientId} onBack={() => navigate(`/platform-console/products/${application.productId}`)} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2}>
            <Field label="Client ID" value={application.clientId} />
            <Field label="Client type" value={application.clientType} />
            <Field label="Grant types" value={application.grantTypes.join(", ") || "—"} />
            <Field label="Redirect URIs" value={application.redirectUris.join(", ") || "—"} />
            <Field label="Allowed scopes" value={application.allowedScopes.join(", ") || "—"} />
            <Field label="Audiences" value={application.audiences.join(", ") || "—"} />
          </Grid>
          <FormControl size="small" sx={{ mt: 2, minWidth: 200 }}>
            <InputLabel id="app-status-label">Status</InputLabel>
            <Select labelId="app-status-label" label="Status" value={application.status} onChange={(e) => handleStatusChange(e.target.value as ApplicationStatus)}>
              <MenuItem value="ACTIVE">Active</MenuItem>
              <MenuItem value="SUSPENDED">Suspended</MenuItem>
              <MenuItem value="DISABLED">Disabled</MenuItem>
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 2 }}>
            No secret rotation or revocation exists for this application — the backend has no such endpoint. The client secret was shown once, at creation.
          </Typography>
        </CardContent>
      </Card>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">Service accounts (machine principals)</Typography>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateSaOpen(true)}>
          Register service account
        </Button>
      </Stack>

      <Card>
        {serviceAccountsQuery.isLoading ? (
          <CardContent>
            <LoadingState dense />
          </CardContent>
        ) : serviceAccountsQuery.isError ? (
          <CardContent>
            <ErrorState description={getApiErrorMessage(serviceAccountsQuery.error)} onRetry={() => serviceAccountsQuery.refetch()} />
          </CardContent>
        ) : !serviceAccountsQuery.data || serviceAccountsQuery.data.items.length === 0 ? (
          <CardContent>
            <EmptyState variant="no-data" title="No service accounts registered under this application" />
          </CardContent>
        ) : (
          <List disablePadding>
            {serviceAccountsQuery.data.items.map((sa) => (
              <ListItem
                key={sa.id}
                divider
                secondaryAction={
                  <Button size="small" onClick={() => handleToggleServiceAccountStatus(sa.id, sa.status)}>
                    {sa.status === "ACTIVE" ? "Suspend" : "Activate"}
                  </Button>
                }
              >
                <ListItemText primary={<Stack direction="row" spacing={1} alignItems="center">{sa.name}<Chip label={sa.status} size="small" /></Stack>} secondary={sa.id} />
              </ListItem>
            ))}
          </List>
        )}
      </Card>

      <Dialog open={createSaOpen} onClose={() => setCreateSaOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Register service account</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            fullWidth
            value={saName}
            onChange={(e) => setSaName(e.target.value)}
            helperText="Its privileges are entirely inherited from this Application's own scopes/audiences/grant types — there is no separate scope to set here."
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateSaOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateServiceAccount} disabled={!saName.trim() || createSaMutation.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {revealedCredential && (
        <OneTimeSecretDialog open onClose={() => setRevealedCredential(null)} label="Service account credential" identity={revealedCredential.name} secret={revealedCredential.credential} />
      )}
    </>
  );
}
