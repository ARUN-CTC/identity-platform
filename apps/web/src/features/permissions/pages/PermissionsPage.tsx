import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Button from "@mui/material/Button";
import { useMemo, useState } from "react";

import { useNotify } from "@/app/providers/NotificationProvider";
import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { FilterBar } from "@/design-system/components/FilterBar";
import { FilterSelect } from "@/design-system/components/FilterSelect";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { useDebounce } from "@/shared/hooks";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { getApiErrorMessage, type Permission } from "@/shared/api";

import { PermissionFormDrawer } from "../PermissionFormDrawer";
import { useDeletePermissionMutation, usePermissionsQuery } from "../hooks";

export default function PermissionsPage() {
  const notify = useNotify();
  const confirm = useConfirm();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput, 300);
  const [resource, setResource] = useState("");
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [drawerState, setDrawerState] = useState<{ open: boolean; permission?: Permission }>({ open: false });

  const queryParams = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: search || undefined,
    resource: resource || undefined,
  };
  const permissionsQuery = usePermissionsQuery(queryParams);
  const deleteMutation = useDeletePermissionMutation();

  // Resource isn't a fixed enum — this filter's own options are derived
  // from whatever the current (unfiltered-by-resource) page has loaded, a
  // real but partial view of the full set. Good enough for a small,
  // rarely-changing catalog; a dedicated distinct-resources endpoint would
  // be needed for a complete list, which the backend doesn't have.
  const resourceOptions = useMemo(() => {
    const codes = new Set((permissionsQuery.data?.items ?? []).map((p) => p.resource));
    return [...codes].sort().map((code) => ({ value: code, label: code }));
  }, [permissionsQuery.data]);

  const handleDelete = async (permission: Permission) => {
    const confirmed = await confirm({
      title: `Delete ${permission.permissionCode}?`,
      description: "This action cannot be undone. If any role still holds this permission, the backend will refuse to delete it.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync(permission.id);
      notify({ message: `${permission.permissionCode} was deleted.`, severity: "success" });
    } catch (error) {
      // A 409 here (still granted to a role) is real and expected.
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const columns: GridColDef<Permission>[] = [
    { field: "permissionCode", headerName: "Code", flex: 1, minWidth: 220 },
    { field: "resource", headerName: "Resource", width: 160 },
    { field: "action", headerName: "Action", width: 130 },
    {
      field: "platformOnly",
      headerName: "Scope",
      width: 150,
      renderCell: (params) =>
        params.row.platformOnly ? (
          <Chip label="Platform-only" size="small" />
        ) : (
          <Chip label="Tenant-grantable" size="small" variant="outlined" color="primary" />
        ),
    },
    { field: "description", headerName: "Description", flex: 1, minWidth: 220, valueGetter: (value) => value || "—" },
    {
      field: "actions",
      headerName: "",
      width: 110,
      sortable: false,
      renderCell: (params) => (
        <PermissionGate permission={PERMISSIONS.ROLE_MANAGE}>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => setDrawerState({ open: true, permission: params.row })} aria-label={`Edit ${params.row.permissionCode}`}>
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" color="error" onClick={() => handleDelete(params.row)} aria-label={`Delete ${params.row.permissionCode}`} disabled={deleteMutation.isPending}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </PermissionGate>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Permission Catalog"
        description="Every permission code known to this platform, including platform-only ones this tenant can view but never grant to its own roles."
        actions={
          <PermissionGate permission={PERMISSIONS.ROLE_MANAGE}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawerState({ open: true })}>
              New permission
            </Button>
          </PermissionGate>
        }
      />

      <DataTable<Permission>
        columns={columns}
        rows={permissionsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={permissionsQuery.isLoading}
        error={permissionsQuery.isError ? permissionsQuery.error : undefined}
        errorMessage={permissionsQuery.isError ? getApiErrorMessage(permissionsQuery.error) : undefined}
        onRetry={() => permissionsQuery.refetch()}
        paginationMode="server"
        rowCount={permissionsQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{
          variant: search || resource ? "no-results" : "no-data",
          title: search || resource ? "No permissions match your filters" : "No permissions found",
        }}
        toolbar={
          <FilterBar
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            searchPlaceholder="Search by permission code…"
            activeFilterCount={resource ? 1 : 0}
            onClearFilters={() => setResource("")}
            filters={<FilterSelect value={resource} onChange={setResource} options={resourceOptions} allLabel="All resources" label="Resource" />}
          />
        }
      />

      <PermissionFormDrawer
        open={drawerState.open}
        permission={drawerState.permission}
        onClose={() => setDrawerState({ open: false })}
      />
    </>
  );
}
