import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import Grid from "@mui/material/Grid";
import InputLabel from "@mui/material/InputLabel";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useNotify } from "@/app/providers/NotificationProvider";
import { EmptyState } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { getApiErrorMessage } from "@/shared/api";
import type { CreatedApplication, ProductStatus } from "@/shared/platform-api";

import { OneTimeSecretDialog } from "../../../components/OneTimeSecretDialog";
import { ApplicationFormDrawer } from "../../applications/ApplicationFormDrawer";
import { useApplicationsForProductQuery } from "../../applications/hooks";
import { usePlatformProductQuery, useUpdatePlatformProductMutation } from "../hooks";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Grid>
  );
}

export default function PlatformProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const [createAppOpen, setCreateAppOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<CreatedApplication | null>(null);

  const productQuery = usePlatformProductQuery(id);
  const applicationsQuery = useApplicationsForProductQuery(id);
  const updateMutation = useUpdatePlatformProductMutation(id ?? "");

  if (productQuery.isLoading) return <LoadingState label="Loading product…" />;
  if (productQuery.isError) {
    return <ErrorState title="Unable to load this product" description={getApiErrorMessage(productQuery.error)} onRetry={() => productQuery.refetch()} />;
  }
  const product = productQuery.data!;

  const handleStatusChange = async (status: ProductStatus) => {
    try {
      await updateMutation.mutateAsync({ status });
      notify({ message: `${product.name} is now ${status}.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  return (
    <>
      <PageHeader title={product.name} description={product.slug} onBack={() => navigate("/platform-console/products")} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2}>
            <Field label="Name" value={product.name} />
            <Field label="Slug" value={product.slug} />
            <Field label="Description" value={product.description || "—"} />
          </Grid>
          <FormControl size="small" sx={{ mt: 2, minWidth: 200 }}>
            <InputLabel id="product-status-label">Status</InputLabel>
            <Select labelId="product-status-label" label="Status" value={product.status} onChange={(e) => handleStatusChange(e.target.value as ProductStatus)}>
              <MenuItem value="ACTIVE">Active</MenuItem>
              <MenuItem value="SUSPENDED">Suspended</MenuItem>
              <MenuItem value="DISABLED">Disabled</MenuItem>
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">Applications (OAuth clients)</Typography>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateAppOpen(true)}>
          Register application
        </Button>
      </Stack>

      <Card>
        {applicationsQuery.isLoading ? (
          <CardContent>
            <LoadingState dense />
          </CardContent>
        ) : applicationsQuery.isError ? (
          <CardContent>
            <ErrorState description={getApiErrorMessage(applicationsQuery.error)} onRetry={() => applicationsQuery.refetch()} />
          </CardContent>
        ) : !applicationsQuery.data || applicationsQuery.data.items.length === 0 ? (
          <CardContent>
            <EmptyState variant="no-data" title="No applications registered under this product" />
          </CardContent>
        ) : (
          <List disablePadding>
            {applicationsQuery.data.items.map((app) => (
              <ListItemButton key={app.id} divider onClick={() => navigate(`/platform-console/applications/${app.id}`)}>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      {app.name}
                      <Chip label={app.status} size="small" />
                      <Chip label={app.clientType} size="small" variant="outlined" />
                    </Stack>
                  }
                  secondary={app.clientId}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Card>

      <ApplicationFormDrawer open={createAppOpen} onClose={() => setCreateAppOpen(false)} productId={id ?? ""} onCreated={(app) => setRevealedSecret(app)} />
      {revealedSecret && revealedSecret.clientSecret && (
        <OneTimeSecretDialog open onClose={() => setRevealedSecret(null)} label="Client secret" identity={revealedSecret.name} secret={revealedSecret.clientSecret} />
      )}
    </>
  );
}
