import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { getApiErrorMessage, type OrganizationSummary } from "@/shared/api";

import { OrganizationFormDrawer } from "../OrganizationFormDrawer";
import { getOrganizationStatusMeta } from "../statusMeta";
import { useOrganizationsQuery } from "../hooks";

export default function OrganizationsPage() {
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [createOpen, setCreateOpen] = useState(false);

  // Backend pagination is 1-indexed (see PaginationQueryDto); MUI DataGrid's is 0-indexed.
  // GET /organizations accepts no search or filter params — see
  // shared/api/organizations.ts's own doc comment — so this directory is
  // deliberately pagination-only, no FilterBar.
  const queryParams = { page: paginationModel.page + 1, limit: paginationModel.pageSize };
  const organizationsQuery = useOrganizationsQuery(queryParams);

  const columns: GridColDef<OrganizationSummary>[] = [
    { field: "organizationCode", headerName: "Code", width: 140 },
    { field: "organizationName", headerName: "Name", flex: 1, minWidth: 220 },
    {
      field: "status",
      headerName: "Status",
      width: 140,
      renderCell: (params) => {
        const meta = getOrganizationStatusMeta(params.row.status as "ACTIVE" | "INACTIVE");
        return <StatusBadge status={meta.statusKey} label={meta.label} />;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Organizations within this tenant."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            New organization
          </Button>
        }
      />

      <DataTable<OrganizationSummary>
        columns={columns}
        rows={organizationsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={organizationsQuery.isLoading}
        error={organizationsQuery.isError ? organizationsQuery.error : undefined}
        errorMessage={organizationsQuery.isError ? getApiErrorMessage(organizationsQuery.error) : undefined}
        onRetry={() => organizationsQuery.refetch()}
        onRowClick={(row) => navigate(`/organizations/${row.id}`)}
        paginationMode="server"
        rowCount={organizationsQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{ variant: "no-data", title: "No organizations found", description: "Create an organization to get started." }}
      />

      <OrganizationFormDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(organization) => navigate(`/organizations/${organization.id}`)}
      />
    </>
  );
}
