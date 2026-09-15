import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";

import { useNotify } from "@/app/providers/NotificationProvider";
import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useConfirm } from "@/design-system/patterns/confirmation";
import { PermissionGate } from "@/shared/components/PermissionGate";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { getApiErrorMessage, type OrganizationType } from "@/shared/api";

import { OrganizationTypeFormDrawer } from "../OrganizationTypeFormDrawer";
import { useDeleteOrganizationTypeMutation, useOrganizationTypesQuery } from "../hooks";

/**
 * `organization_type` is global reference data — no `tenant_id`, no RLS
 * (see the backend repository's own header comment). Every type created,
 * edited, or deleted here is visible to and shared by every tenant on the
 * platform, not scoped to this caller's own tenant — unlike almost
 * everything else this console manages. The page copy below says so
 * explicitly rather than leaving it implicit.
 *
 * No search/sort/filter here: `GET /organization-types` only accepts
 * page/limit (PaginationQueryDto's `sortBy`/`sortOrder` are accepted by the
 * DTO but silently ignored — the repository hardcodes `orderBy: { typeName:
 * 'asc' }`) — matching that exactly rather than building controls the
 * backend won't honor.
 */
export default function OrganizationTypesPage() {
  const notify = useNotify();
  const confirm = useConfirm();
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [drawerState, setDrawerState] = useState<{ open: boolean; organizationType?: OrganizationType }>({ open: false });

  const queryParams = { page: paginationModel.page + 1, limit: paginationModel.pageSize };
  const typesQuery = useOrganizationTypesQuery(queryParams);
  const deleteMutation = useDeleteOrganizationTypeMutation();

  const handleDelete = async (organizationType: OrganizationType) => {
    const confirmed = await confirm({
      title: `Delete ${organizationType.typeName}?`,
      description:
        "This type is shared platform-wide, not just this tenant. Deleting it removes it from the picker for new organizations — organizations that already use it keep working, unchanged. This cannot be undone from here.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync(organizationType.id);
      notify({ message: `${organizationType.typeName} was deleted.`, severity: "success" });
    } catch (error) {
      notify({ message: getApiErrorMessage(error), severity: "error" });
    }
  };

  const columns: GridColDef<OrganizationType>[] = [
    { field: "typeCode", headerName: "Code", width: 160 },
    { field: "typeName", headerName: "Name", flex: 1, minWidth: 200 },
    { field: "description", headerName: "Description", flex: 1, minWidth: 220, valueGetter: (value) => value || "—" },
    {
      field: "isActive",
      headerName: "Status",
      width: 130,
      renderCell: (params) =>
        params.row.isActive ? (
          <Chip label="Active" size="small" color="success" variant="outlined" />
        ) : (
          <Chip label="Inactive" size="small" variant="outlined" />
        ),
    },
    {
      field: "actions",
      headerName: "",
      width: 110,
      sortable: false,
      renderCell: (params) => (
        <PermissionGate permission={PERMISSIONS.ORGANIZATION_MANAGE}>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Edit">
              <IconButton
                size="small"
                onClick={() => setDrawerState({ open: true, organizationType: params.row })}
                aria-label={`Edit ${params.row.typeName}`}
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton
                size="small"
                color="error"
                onClick={() => handleDelete(params.row)}
                aria-label={`Delete ${params.row.typeName}`}
                disabled={deleteMutation.isPending}
              >
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
        title="Organization Types"
        description="The type catalog available when creating or editing an organization — shared across every tenant on the platform, not just this one."
        actions={
          <PermissionGate permission={PERMISSIONS.ORGANIZATION_MANAGE}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawerState({ open: true })}>
              New type
            </Button>
          </PermissionGate>
        }
      />

      <DataTable<OrganizationType>
        columns={columns}
        rows={typesQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={typesQuery.isLoading}
        error={typesQuery.isError ? typesQuery.error : undefined}
        errorMessage={typesQuery.isError ? getApiErrorMessage(typesQuery.error) : undefined}
        onRetry={() => typesQuery.refetch()}
        paginationMode="server"
        rowCount={typesQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{ variant: "no-data", title: "No organization types found" }}
      />

      <OrganizationTypeFormDrawer
        open={drawerState.open}
        organizationType={drawerState.organizationType}
        onClose={() => setDrawerState({ open: false })}
      />
    </>
  );
}
