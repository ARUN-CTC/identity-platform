import { useMemo, useState } from "react";

import { useDebounce } from "@/shared/hooks/useDebounce";

/**
 * Generic filter-state hook for list pages: debounced search text plus an
 * arbitrary filter object, with a computed active-filter count for
 * FilterBar's "Clear filters (n)" affordance.
 *
 * `TFilters` values are treated as "unset" when `undefined`/`null`/`""`, so
 * pages typically define it as `Partial<{ status: StatusKey; ownerId: string }>`.
 *
 * Saved-filter persistence (spec §16) isn't implemented yet — `filters`
 * here is already the serializable shape a future "save this filter" API
 * would accept.
 */
export function useFilters<TFilters extends Record<string, unknown>>(initialFilters: TFilters) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<TFilters>(initialFilters);
  const debouncedSearch = useDebounce(search, 300);

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((value) => value !== undefined && value !== null && value !== "").length,
    [filters],
  );

  const setFilter = <K extends keyof TFilters>(key: K, value: TFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters(initialFilters);
    setSearch("");
  };

  return {
    search,
    setSearch,
    debouncedSearch,
    filters,
    setFilter,
    setFilters,
    clearFilters,
    activeFilterCount,
  };
}
