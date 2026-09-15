import AddIcon from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable, type GridColDef, type GridPaginationModel } from "@/design-system/components/DataTable";
import { PageHeader } from "@/design-system/components/PageHeader";
import { getApiErrorMessage } from "@/shared/api";
import type { PlatformProduct } from "@/shared/platform-api";

import { ProductFormDrawer } from "../ProductFormDrawer";
import { usePlatformProductsQuery } from "../hooks";

function statusColor(status: string): "success" | "warning" | "default" {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "warning";
  return "default";
}

export default function PlatformProductsPage() {
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [createOpen, setCreateOpen] = useState(false);
  const productsQuery = usePlatformProductsQuery({ page: paginationModel.page + 1, limit: paginationModel.pageSize });

  const columns: GridColDef<PlatformProduct>[] = [
    { field: "name", headerName: "Product", flex: 1, minWidth: 200 },
    { field: "slug", headerName: "Slug", width: 180 },
    { field: "status", headerName: "Status", width: 140, renderCell: (params) => <Chip label={params.row.status} size="small" color={statusColor(params.row.status)} /> },
    { field: "description", headerName: "Description", flex: 1, minWidth: 220, valueGetter: (value) => value || "—" },
  ];

  return (
    <>
      <PageHeader
        title="Products"
        description="SaaS offerings registered on this platform. Applications and tenant entitlements are scoped to one of these."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            Register product
          </Button>
        }
      />

      <DataTable<PlatformProduct>
        columns={columns}
        rows={productsQuery.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={productsQuery.isLoading}
        error={productsQuery.isError ? productsQuery.error : undefined}
        errorMessage={productsQuery.isError ? getApiErrorMessage(productsQuery.error) : undefined}
        onRetry={() => productsQuery.refetch()}
        onRowClick={(row) => navigate(`/platform-console/products/${row.id}`)}
        paginationMode="server"
        rowCount={productsQuery.data?.meta.total ?? 0}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        emptyState={{ variant: "no-data", title: "No products registered yet" }}
      />

      <ProductFormDrawer open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => navigate(`/platform-console/products/${id}`)} />
    </>
  );
}
