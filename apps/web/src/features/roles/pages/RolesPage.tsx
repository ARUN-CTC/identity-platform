import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { FilterBar } from "@/design-system/components/FilterBar";
import { PageHeader } from "@/design-system/components/PageHeader";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { useDebounce } from "@/shared/hooks";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { getApiErrorMessage, type Role } from "@/shared/api";

import { RoleFormDrawer } from "../RoleFormDrawer";
import { useRolesQuery } from "../hooks";

export default function RolesPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput, 300);
  const [includeSystem, setIncludeSystem] = useState(true);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [createOpen, setCreateOpen] = useState(false);

  // Backend pagination is 1-indexed (see PaginationQueryDto); MUI DataGrid's is 0-indexed.
  const queryParams = { page: paginationModel.page + 1, limit: paginationModel.pageSize, search: search || undefined, includeSystem };
  const rolesQuery = useRolesQuery(queryParams);

  const columns: GridColDef<Role>[] = [
    { field: "roleName", headerName: "Role", flex: 1, minWidth: 200 },
    { field: "roleCode", headerName: "Code", width: 200 },
    {
      field: "isSystem",
      headerName: "Scope",
      width: 130,
      renderCell: (params) =>
        params.row.isSystem ? (
          <Chip label="System" size="small" variant="outlined" />
        ) : (
          <Chip label="Custom" size="small" variant="outlined" color="primary" />
        ),
    },
    { field: "description", headerName: "Description", flex: 1, minWidth: 220, valueGetter: (value) => value || "—" },
  ];

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Roles available in this tenant, and the permissions each one grants."
        actions={
          <PermissionGate permission={PERMISSIONS.ROLE_MANAGE}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
              New role
            </Button>
          </PermissionGate>
        }
      />

      <DataTable<Role>
        columns={columns}
        rows={rolesQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={rolesQuery.isLoading}
        error={rolesQuery.isError ? rolesQuery.error : undefined}
        errorMessage={rolesQuery.isError ? getApiErrorMessage(rolesQuery.error) : undefined}
        onRetry={() => rolesQuery.refetch()}
        onRowClick={(row) => navigate(`/roles/${row.id}`)}
        paginationMode="server"
        rowCount={rolesQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{
          variant: search ? "no-results" : "no-data",
          title: search ? "No roles match your search" : "No roles found",
        }}
        toolbar={
          <FilterBar
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            searchPlaceholder="Search by role name or code…"
            filters={
              <FormControlLabel
                control={<Checkbox checked={includeSystem} onChange={(event) => setIncludeSystem(event.target.checked)} size="small" />}
                label="Include system roles"
              />
            }
          />
        }
      />

      <RoleFormDrawer open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(role) => navigate(`/roles/${role.id}`)} />
    </>
  );
}
