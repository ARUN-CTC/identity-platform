import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { FilterBar } from "@/design-system/components/FilterBar";
import { FilterSelect } from "@/design-system/components/FilterSelect";
import { PageHeader } from "@/design-system/components/PageHeader";
import { StatusBadge } from "@/design-system/components/StatusBadge";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { useDebounce, usePermissions } from "@/shared/hooks";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { getApiErrorMessage, type User, type UserStatus } from "@/shared/api";

import { CreateUserDrawer } from "../CreateUserDrawer";
import { getUserStatusMeta } from "../statusMeta";
import { useUsersQuery } from "../hooks";

const STATUS_OPTIONS: { value: UserStatus; label: string }[] = [
  { value: "PROVISIONED", label: "Invited" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "DEACTIVATED", label: "Deactivated" },
];

function displayName(user: User): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

export default function UsersPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput, 300);
  const [status, setStatus] = useState<UserStatus | "">("");
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [createOpen, setCreateOpen] = useState(false);

  // Backend pagination is 1-indexed (see PaginationQueryDto); MUI DataGrid's is 0-indexed.
  const queryParams = useMemo(
    () => ({
      page: paginationModel.page + 1,
      limit: paginationModel.pageSize,
      search: search || undefined,
      status: status || undefined,
    }),
    [paginationModel, search, status],
  );

  const usersQuery = useUsersQuery(queryParams);
  const canCreate = usePermissions([PERMISSIONS.USER_MANAGE, PERMISSIONS.ORGANIZATION_MANAGE], "all");

  const columns: GridColDef<User>[] = [
    { field: "name", headerName: "Name", flex: 1, minWidth: 180, valueGetter: (_value, row) => displayName(row) },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220 },
    {
      field: "status",
      headerName: "Status",
      width: 140,
      renderCell: (params) => {
        const meta = getUserStatusMeta(params.row.status);
        return <StatusBadge status={meta.statusKey} label={meta.label} />;
      },
    },
    {
      field: "lastLoginAt",
      headerName: "Last login",
      width: 180,
      valueGetter: (value) => (value ? new Date(value as string).toLocaleString() : "Never"),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Every user with a membership in this tenant."
        actions={
          <PermissionGate
            permission={PERMISSIONS.USER_MANAGE}
            fallback={null}
          >
            <Tooltip title={canCreate ? "" : "Creating a user also requires the Organizations permission"}>
              <span>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)} disabled={!canCreate}>
                  New user
                </Button>
              </span>
            </Tooltip>
          </PermissionGate>
        }
      />

      <DataTable<User>
        columns={columns}
        rows={usersQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={usersQuery.isLoading}
        error={usersQuery.isError ? usersQuery.error : undefined}
        errorMessage={usersQuery.isError ? getApiErrorMessage(usersQuery.error) : undefined}
        onRetry={() => usersQuery.refetch()}
        onRowClick={(row) => navigate(`/users/${row.id}`)}
        paginationMode="server"
        rowCount={usersQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{
          variant: search || status ? "no-results" : "no-data",
          title: search || status ? "No users match your filters" : "No users found",
          description: search || status ? "Try a different search term or clear your filters." : "Add a user to get started.",
        }}
        toolbar={
          <FilterBar
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            searchPlaceholder="Search by name, email, or username…"
            activeFilterCount={status ? 1 : 0}
            onClearFilters={() => setStatus("")}
            filters={
              <FilterSelect
                value={status}
                onChange={(value) => setStatus(value as UserStatus | "")}
                options={STATUS_OPTIONS}
                allLabel="All statuses"
                label="Status"
              />
            }
          />
        }
      />

      <CreateUserDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
