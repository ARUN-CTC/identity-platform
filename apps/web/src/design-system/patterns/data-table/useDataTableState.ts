import type { GridPaginationModel, GridRowSelectionModel, GridSortModel } from "@mui/x-data-grid";
import { useState } from "react";

export interface DataTableState {
  paginationModel: GridPaginationModel;
  setPaginationModel: (model: GridPaginationModel) => void;
  sortModel: GridSortModel;
  setSortModel: (model: GridSortModel) => void;
  rowSelectionModel: GridRowSelectionModel;
  setRowSelectionModel: (model: GridRowSelectionModel) => void;
  selectedCount: number;
  clearSelection: () => void;
}

/**
 * Bundles the pagination/sort/selection state every DataTable instance
 * needs, whether it's driven client-side or wired to server-side
 * queries — pass `paginationModel`/`sortModel` straight through to a
 * react-query key when `mode="server"`.
 */
export function useDataTableState(initialPageSize = 25): DataTableState {
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: initialPageSize,
  });
  const [sortModel, setSortModel] = useState<GridSortModel>([]);
  const [rowSelectionModel, setRowSelectionModel] = useState<GridRowSelectionModel>([]);

  return {
    paginationModel,
    setPaginationModel,
    sortModel,
    setSortModel,
    rowSelectionModel,
    setRowSelectionModel,
    selectedCount: rowSelectionModel.length,
    clearSelection: () => setRowSelectionModel([]),
  };
}
