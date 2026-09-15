import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import type { SxProps, Theme } from "@mui/material/styles";

interface GlobalSearchFieldProps {
  /** Overrides the default placement/width styling on the wrapping `Box`. */
  sx?: SxProps<Theme>;
}

/**
 * The shell's global-search integration point.
 *
 * No backend global-search endpoint exists yet for any entity (each list
 * page has its own real, working search + filters instead — see that
 * page's own `FilterBar`). This is intentionally NOT a disabled field:
 * an HTML `disabled` control is removed from the tab order entirely, so a
 * keyboard or screen-reader user could never reach it or discover *why* it
 * doesn't work — only a mouse-hover Tooltip would ever explain it. This
 * version stays focusable and keeps the same honest, inert behavior
 * (read-only — typing is a visible no-op, not a silent one) while making
 * the explanation reachable by focus too, matching how MUI's Tooltip
 * already opens on focus for any focusable child.
 *
 * It still looks inert (muted text/border, disabled-style icon) so it
 * doesn't read as a working search box for sighted mouse users either.
 *
 * Swap this component's internals for a real, wired search once a global
 * search endpoint exists — every place the shell surfaces search should
 * import this one component, not a page-local reimplementation.
 */
export function GlobalSearchField({ sx }: GlobalSearchFieldProps) {
  return (
    <Box role="search" sx={{ flex: 1, maxWidth: 480, display: { xs: "none", sm: "block" }, ...sx }}>
      <Tooltip title="Global search isn't available yet — use each list page's own search and filters.">
        <TextField
          fullWidth
          size="small"
          placeholder="Search coming soon…"
          slotProps={{
            // `aria-label` must land on the actual `<input>` (via
            // `htmlInput`), not the root `TextField` prop — that spreads
            // onto the outer `FormControl` div instead, leaving the
            // focusable, screen-reader-facing element with no accessible
            // name of its own.
            htmlInput: { readOnly: true, "aria-readonly": true, "aria-label": "Global search (not yet available)" },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="disabled" />
                </InputAdornment>
              ),
            },
          }}
          sx={{
            "& .MuiOutlinedInput-root": {
              color: "text.disabled",
              cursor: "default",
              "& fieldset": { borderColor: "action.disabled" },
              "&:hover fieldset": { borderColor: "action.disabled" },
              "&.Mui-focused fieldset": { borderColor: "action.disabled", borderWidth: 1 },
            },
            "& .MuiInputBase-input": { cursor: "default" },
          }}
        />
      </Tooltip>
    </Box>
  );
}
