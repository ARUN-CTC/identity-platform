import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";

export interface FilterSelectOption {
  value: string;
  label: string;
}

export interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: FilterSelectOption[];
  /** The empty-selection row's label, e.g. "All statuses". Its value is always `""`. */
  allLabel: string;
  /** Accessible name — defaults to `allLabel`, override when the visible "All X" text alone wouldn't tell a screen-reader user which filter this is. */
  label?: string;
  minWidth?: number;
}

/**
 * The one-of-many-values filter dropdown used in almost every list page's
 * FilterBar — "All statuses" (or "All types", "All channels", ...) plus one
 * row per enum value. Extracted after finding this exact `Select` +
 * `MenuItem` shape independently repeated across 30+ list pages (status/
 * type/channel filters for Inquiries, Quotations, Bookings, Payments,
 * Customers, Travelers, Users, Roles, Permissions, Documents, WhatsApp/
 * Email config, ...). Reach for this for any new "All X" filter rather
 * than hand-rolling another `Select`/`MenuItem` pair — existing call sites
 * are adopted incrementally, not all at once (see architecture.md).
 */
export function FilterSelect({ value, onChange, options, allLabel, label, minWidth = 160 }: FilterSelectProps) {
  return (
    <Select
      size="small"
      displayEmpty
      value={value}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth }}
      aria-label={label ?? allLabel}
    >
      <MenuItem value="">{allLabel}</MenuItem>
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </Select>
  );
}
