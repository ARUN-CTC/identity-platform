import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { getApiErrorMessage } from "@/shared/api";
import type { PlatformTenant } from "@/shared/platform-api";

import { PlatformTenantFormDrawer } from "../PlatformTenantFormDrawer";
import { usePlatformTenantsQuery } from "../hooks";
import { getTenantStatusMeta } from "../statusMeta";

/**
 * The platform-wide tenant registry (`GET /platform/tenants`) — every
 * tenant on the platform, gated on `PLATFORM_TENANT_VIEW`. This is the
 * corrected home for the capability that used to live, unscoped, behind
 * the tenant-grantable `TENANT_MANAGE` — see
 * [[tenant-manage-unscoped-registry-vulnerability]].
 */
export default function PlatformTenantsPage() {
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [createOpen, setCreateOpen] = useState(false);

  const queryParams = { page: paginationModel.page + 1, limit: paginationModel.pageSize };
  const tenantsQuery = usePlatformTenantsQuery(queryParams);

  const columns: GridColDef<PlatformTenant>[] = [
    { field: "tenantName", headerName: "Tenant", flex: 1, minWidth: 200 },
    { field: "tenantCode", headerName: "Code", width: 160 },
    {
      field: "status",
      headerName: "Status",
      width: 150,
      renderCell: (params) => {
        const meta = getTenantStatusMeta(params.row.status);
        return <StatusBadge status={meta.statusKey} label={meta.label} />;
      },
    },
    { field: "email", headerName: "Email", flex: 1, minWidth: 200, valueGetter: (value) => value || "—" },
  ];

  return (
    <>
      <PageHeader
        title="Tenant Registry"
        description="Every tenant on the platform. Reserved for Platform Operators — a tenant's own admin never sees this."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            Register tenant
          </Button>
        }
      />

      <DataTable<PlatformTenant>
        columns={columns}
        rows={tenantsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={tenantsQuery.isLoading}
        error={tenantsQuery.isError ? tenantsQuery.error : undefined}
        errorMessage={tenantsQuery.isError ? getApiErrorMessage(tenantsQuery.error) : undefined}
        onRetry={() => tenantsQuery.refetch()}
        onRowClick={(row) => navigate(`/platform-console/tenants/${row.id}`)}
        paginationMode="server"
        rowCount={tenantsQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{ variant: "no-data", title: "No tenants registered yet" }}
      />

      <PlatformTenantFormDrawer open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => navigate(`/platform-console/tenants/${id}`)} />
    </>
  );
}
