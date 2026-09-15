import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { PageHeader } from "@/design-system/components/PageHeader";
import { getApiErrorMessage } from "@/shared/api";
import type { PlatformOperatorRecord } from "@/shared/platform-api";

import { CreateOperatorDrawer } from "../CreateOperatorDrawer";
import { usePlatformOperatorsQuery } from "../hooks";

export default function PlatformOperatorsPage() {
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [createOpen, setCreateOpen] = useState(false);
  const operatorsQuery = usePlatformOperatorsQuery({ page: paginationModel.page + 1, limit: paginationModel.pageSize });

  const columns: GridColDef<PlatformOperatorRecord>[] = [
    { field: "userId", headerName: "Identity", flex: 1, minWidth: 240 },
    { field: "status", headerName: "Status", width: 140, renderCell: (params) => <Chip label={params.row.status} size="small" color={params.row.status === "ACTIVE" ? "success" : "default"} /> },
    { field: "createdAt", headerName: "Created", width: 190, valueGetter: (value) => new Date(value as string).toLocaleString() },
  ];

  return (
    <>
      <PageHeader
        title="Platform Operators"
        description="Who holds platform-wide administrative authority. Requires an existing, already-activated Identity Platform account — this never provisions a new one."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            Grant operator authority
          </Button>
        }
      />

      <DataTable<PlatformOperatorRecord>
        columns={columns}
        rows={operatorsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={operatorsQuery.isLoading}
        error={operatorsQuery.isError ? operatorsQuery.error : undefined}
        errorMessage={operatorsQuery.isError ? getApiErrorMessage(operatorsQuery.error) : undefined}
        onRetry={() => operatorsQuery.refetch()}
        onRowClick={(row) => navigate(`/platform-console/operators/${row.id}`)}
        paginationMode="server"
        rowCount={operatorsQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{ variant: "no-data", title: "No platform operators found" }}
      />

      <CreateOperatorDrawer open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => navigate(`/platform-console/operators/${id}`)} />
    </>
  );
}
