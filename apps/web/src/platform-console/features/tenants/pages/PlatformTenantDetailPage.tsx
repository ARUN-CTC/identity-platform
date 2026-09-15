import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PauseCircleOutlinedIcon from "@mui/icons-material/PauseCircleOutlined";
import PlayCircleOutlinedIcon from "@mui/icons-material/PlayCircleOutlined";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";

import { useNotify } from "@/app/providers/NotificationProvider";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { getApiErrorMessage } from "@/shared/api";

import { PlatformTenantEditDrawer } from "../PlatformTenantEditDrawer";
import { useActivatePlatformTenantMutation, useDeletePlatformTenantMutation, usePlatformTenantQuery, useSuspendPlatformTenantMutation } from "../hooks";
import { getTenantStatusMeta } from "../statusMeta";

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

export default function PlatformTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notify = useNotify();
  const confirm = useConfirm();
  const [editOpen, setEditOpen] = useState(false);

  const tenantQuery = usePlatformTenantQuery(id);
  const activateMutation = useActivatePlatformTenantMutation(id ?? "");
  const suspendMutation = useSuspendPlatformTenantMutation(id ?? "");
  const deleteMutation = useDeletePlatformTenantMutation();

  if (tenantQuery.isLoading) {
    return <LoadingState label="Loading tenant…" />;
  }
  if (tenantQuery.isError) {
    return <ErrorState title="Unable to load this tenant" description={getApiErrorMessage(tenantQuery.error)} onRetry={() => tenantQuery.refetch()} />;
  }

  const tenant = tenantQuery.data!;
  const statusMeta = getTenantStatusMeta(tenant.status);

  const handleActivate = async () => {
    try {
      await activateMutation.mutateAsync();
      notify({ message: `${tenant.tenantName} was activated.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleSuspend = async () => {
    const confirmed = await confirm({
      title: `Suspend ${tenant.tenantName}?`,
      description: "Every user in this tenant loses access immediately. This does not delete any data.",
      confirmLabel: "Suspend",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await suspendMutation.mutateAsync();
      notify({ message: `${tenant.tenantName} was suspended.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: `Delete ${tenant.tenantName}?`,
      description: "This soft-deletes the tenant. The backend applies no dependency check (existing users/organizations are not blocked or removed) — this action cannot be undone from this console.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync(tenant.id);
      notify({ message: `${tenant.tenantName} was deleted.`, severity: "success" });
      navigate("/platform-console/tenants");
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  return (
    <>
      <PageHeader
        title={tenant.tenantName}
        description={tenant.tenantCode}
        status={<StatusBadge status={statusMeta.statusKey} label={statusMeta.label} />}
        onBack={() => navigate("/platform-console/tenants")}
        actions={
          <>
            <Tooltip title="Edit tenant">
              <IconButton onClick={() => setEditOpen(true)} aria-label="Edit tenant">
                <EditOutlinedIcon />
              </IconButton>
            </Tooltip>
            {tenant.status !== "ACTIVE" && (
              <Tooltip title="Activate tenant">
                <IconButton onClick={handleActivate} aria-label="Activate tenant" disabled={activateMutation.isPending} color="success">
                  <PlayCircleOutlinedIcon />
                </IconButton>
              </Tooltip>
            )}
            {tenant.status === "ACTIVE" && (
              <Tooltip title="Suspend tenant">
                <IconButton onClick={handleSuspend} aria-label="Suspend tenant" disabled={suspendMutation.isPending} color="warning">
                  <PauseCircleOutlinedIcon />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Delete tenant">
              <IconButton onClick={handleDelete} aria-label="Delete tenant" disabled={deleteMutation.isPending} color="error">
                <DeleteOutlineIcon />
              </IconButton>
            </Tooltip>
          </>
        }
      />

      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Field label="Tenant code" value={tenant.tenantCode} />
            <Field label="Tenant name" value={tenant.tenantName} />
            <Field label="Legal name" value={tenant.legalName || "—"} />
            <Field label="Email" value={tenant.email || "—"} />
            <Field label="Phone" value={tenant.phone || "—"} />
            <Field label="Status" value={statusMeta.label} />
          </Grid>
        </CardContent>
      </Card>

      <Stack direction="row" spacing={3} sx={{ mt: 3 }}>
        <Link component={RouterLink} to={`/platform-console/tenants/${tenant.id}/entitlements`} variant="body2">
          Manage product entitlements →
        </Link>
        <Link component={RouterLink} to={`/platform-console/tenants/${tenant.id}/service-account-grants`} variant="body2">
          Manage service account grants →
        </Link>
      </Stack>

      <PlatformTenantEditDrawer open={editOpen} onClose={() => setEditOpen(false)} tenant={tenant} />
    </>
  );
}
