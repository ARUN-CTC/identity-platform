import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { ReactNode } from "react";

export interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /** Filter controls (Select/Autocomplete/DateRangePicker etc.), rendered inline after search. */
  filters?: ReactNode;
  activeFilterCount?: number;
  onClearFilters?: () => void;
}

/**
 * Page-level search + filter bar — distinct from the Topbar's global
 * search (see design-system/patterns/search-filter for the full pattern
 * write-up on Global vs Page vs Advanced search).
 */
export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  activeFilterCount = 0,
  onClearFilters,
}: FilterBarProps) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
      <TextField
        size="small"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={searchPlaceholder}
        aria-label="Search"
        name="page-filter-search"
        autoComplete="off"
        sx={{ minWidth: 240 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="disabled" />
              </InputAdornment>
            ),
            endAdornment: searchValue ? (
              <InputAdornment position="end">
                <IconButton size="small" aria-label="Clear search" onClick={() => onSearchChange("")}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          },
        }}
      />

      {filters && <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>{filters}</Box>}

      {activeFilterCount > 0 && onClearFilters && (
        <Button size="small" color="inherit" onClick={onClearFilters} startIcon={<CloseIcon fontSize="small" />}>
          Clear filters ({activeFilterCount})
        </Button>
      )}
    </Stack>
  );
}
