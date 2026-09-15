import { DataGrid } from "@mui/x-data-grid";
import type {
  GridColDef,
  GridPaginationModel,
  GridRowId,
  GridRowSelectionModel,
  GridSortModel,
  GridValidRowModel,
} from "@mui/x-data-grid";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import { EmptyState, type EmptyStateProps } from "@/design-system/components/EmptyState";
import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";

export interface DataTableProps<T extends GridValidRowModel> {
  columns: GridColDef<T>[];
  rows: T[];
  getRowId?: (row: T) => GridRowId;
  loading?: boolean;
  error?: unknown;
  /**
   * The real, user-safe message for `error` (e.g. `getApiErrorMessage(error)`)
   * — deliberately a plain string the caller computes, not something this
   * component derives itself, so DataTable never needs to know about
   * `ApiError`/`shared/api` at all. Omit to fall back to ErrorState's own
   * generic default; every existing call site that only passes `error`
   * keeps behaving exactly as before.
   */
  errorMessage?: string;
  onRetry?: () => void;
  emptyState?: Partial<EmptyStateProps>;

  /** "server" assumes `rows` is already the current page and `rowCount` is the true total. */
  paginationMode?: "client" | "server";
  rowCount?: number;
  paginationModel?: GridPaginationModel;
  onPaginationModelChange?: (model: GridPaginationModel) => void;
  pageSizeOptions?: number[];

  sortingMode?: "client" | "server";
  sortModel?: GridSortModel;
  onSortModelChange?: (model: GridSortModel) => void;

  checkboxSelection?: boolean;
  rowSelectionModel?: GridRowSelectionModel;
  onRowSelectionModelChange?: (model: GridRowSelectionModel) => void;
  /** Rendered in the header bar, typically bulk-action buttons — shown only while callers keep it non-null (e.g. selection.length > 0). */
  bulkActions?: ReactNode;
  /** Rendered above the grid, typically a FilterBar. */
  toolbar?: ReactNode;

  density?: "compact" | "standard" | "comfortable";
  height?: number | string;
  onRowClick?: (row: T) => void;
}

/**
 * TravelOS's enterprise data table — a themed wrapper around MUI X
 * DataGrid (Community) that standardizes loading/error/empty states,
 * server-pagination plumbing, and bulk-action placement so every domain
 * table looks and behaves the same. Domains should not reach for
 * `@mui/x-data-grid` directly — extend this component instead.
 */
export function DataTable<T extends GridValidRowModel>({
  columns,
  rows,
  getRowId,
  loading = false,
  error,
  errorMessage,
  onRetry,
  emptyState,
  paginationMode = "client",
  rowCount,
  paginationModel,
  onPaginationModelChange,
  pageSizeOptions = [10, 25, 50, 100],
  sortingMode = "client",
  sortModel,
  onSortModelChange,
  checkboxSelection = false,
  rowSelectionModel,
  onRowSelectionModelChange,
  bulkActions,
  toolbar,
  density = "standard",
  height = 560,
  onRowClick,
}: DataTableProps<T>) {
  if (error) {
    return (
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2 }}>
        <ErrorState description={errorMessage} onRetry={onRetry} dense />
      </Box>
    );
  }

  return (
    <Stack spacing={1.5}>
      {(toolbar || bulkActions) && (
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{toolbar}</Box>
          {bulkActions && (
            <Stack direction="row" alignItems="center" spacing={1}>
              {bulkActions}
            </Stack>
          )}
        </Stack>
      )}

      <Box sx={{ height, width: "100%" }}>
        <DataGrid<T>
          columns={columns}
          rows={rows}
          getRowId={getRowId}
          loading={loading}
          density={density}
          disableRowSelectionOnClick
          checkboxSelection={checkboxSelection}
          rowSelectionModel={rowSelectionModel}
          onRowSelectionModelChange={onRowSelectionModelChange}
          paginationMode={paginationMode}
          rowCount={paginationMode === "server" ? rowCount : undefined}
          paginationModel={paginationModel}
          onPaginationModelChange={onPaginationModelChange}
          pageSizeOptions={pageSizeOptions}
          sortingMode={sortingMode}
          sortModel={sortModel}
          onSortModelChange={onSortModelChange}
          onRowClick={onRowClick ? (params) => onRowClick(params.row) : undefined}
          slots={{
            noRowsOverlay: () => (
              <EmptyState title="No records found" variant="no-data" {...emptyState} />
            ),
            // Swaps DataGrid's bare default spinner (no accessible name) for
            // our own themed, labeled LoadingState — consistent with every
            // other loading indicator in the app, and accessible by default.
            loadingOverlay: () => <LoadingState label="Loading…" dense />,
          }}
          // Static enterprise-flat styling (borders, header/cell typography,
          // focus ring) lives in themes/components.ts's MuiDataGrid override
          // so it stays consistent with every other themed component; only
          // this instance's prop-dependent cursor lives here.
          sx={{
            "& .MuiDataGrid-row": {
              cursor: onRowClick ? "pointer" : "default",
            },
          }}
        />
      </Box>
    </Stack>
  );
}

export function DataTableCaption({ children }: { children: ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary">
      {children}
    </Typography>
  );
}

export type { GridColDef, GridPaginationModel, GridRowSelectionModel, GridSortModel };
