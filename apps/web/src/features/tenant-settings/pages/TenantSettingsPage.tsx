import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { getApiErrorMessage } from "@/shared/api";

import { TenantSettingsFormDrawer } from "../TenantSettingsFormDrawer";
import { useOwnTenantQuery } from "../hooks";
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

/**
 * This tenant's own registration profile — `GET/PATCH /tenants/me`, which
 * takes no id at all (resolved server-side from the caller's JWT; see
 * shared/api/tenants.ts's header comment on the Phase 2D fix). No tenant
 * picker, no "switch tenant" affordance, no id displayed as editable — there
 * is no id to substitute in the first place.
 *
 * Status (PROVISIONING/ACTIVE/SUSPENDED) is shown read-only. It is
 * intentionally not editable here: activate/suspend are their own
 * dedicated endpoints with no state-machine validation
 * (TenantsService.activate()/suspend() apply no current-status check at
 * all), and per the Tenant Settings brief §7 (Platform Operator boundary),
 * tenant lifecycle control belongs to a separate Platform Operator surface,
 * not this tenant's own admin console.
 */
export default function TenantSettingsPage() {
  const [editOpen, setEditOpen] = useState(false);
  const tenantQuery = useOwnTenantQuery();

  if (tenantQuery.isLoading) {
    return <LoadingState label="Loading tenant settings…" />;
  }

  if (tenantQuery.isError) {
    return (
      <ErrorState
        title="Unable to load tenant settings"
        description={getApiErrorMessage(tenantQuery.error)}
        onRetry={() => tenantQuery.refetch()}
      />
    );
  }

  const record = tenantQuery.data!;
  const statusMeta = getTenantStatusMeta(record.status);

  return (
    <>
      <PageHeader
        title={record.tenantName}
        description={record.tenantCode}
        status={<StatusBadge status={statusMeta.statusKey} label={statusMeta.label} />}
        actions={
          <Tooltip title="Edit tenant settings">
            <IconButton onClick={() => setEditOpen(true)} aria-label="Edit tenant settings">
              <EditOutlinedIcon />
            </IconButton>
          </Tooltip>
        }
      />

      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Field label="Tenant code" value={record.tenantCode} />
            <Field label="Tenant name" value={record.tenantName} />
            <Field label="Legal name" value={record.legalName || "—"} />
            <Field label="Email" value={record.email || "—"} />
            <Field label="Phone" value={record.phone || "—"} />
            <Field label="Status" value={statusMeta.label} />
          </Grid>
        </CardContent>
      </Card>

      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 2 }}>
        Activating, suspending, or transferring this tenant is not available here — those are platform-level
        operations, not part of this tenant's own settings.
      </Typography>

      <TenantSettingsFormDrawer open={editOpen} onClose={() => setEditOpen(false)} tenant={record} />
    </>
  );
}
