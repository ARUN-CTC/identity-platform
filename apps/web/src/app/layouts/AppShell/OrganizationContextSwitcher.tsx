import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import MenuItem from "@mui/material/MenuItem";
import Select, { type SelectChangeEvent } from "@mui/material/Select";
import { useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { useNotify } from "@/app/providers/NotificationProvider";
import { ApiError, getApiErrorMessage } from "@/shared/api";

const TENANT_WIDE_VALUE = "__tenant_wide__";

/**
 * Organization-context switcher — deliberately renders nothing for the
 * overwhelming majority of users, who hold zero organization-scoped role
 * grants (`availableOrganizations` is empty). Offers every organization the
 * caller holds an ACTIVE membership in, across every tenant (`GET
 * /me/organizations`) — the backend resolves whether a given selection is a
 * same-tenant or cross-tenant switch; the frontend never needs to know
 * which before asking.
 */
export function OrganizationContextSwitcher() {
  const { organizationContext, availableOrganizations, switchOrganization } = useAuth();
  const notify = useNotify();
  const [switching, setSwitching] = useState(false);

  if (availableOrganizations.length === 0) return null;

  const value = organizationContext?.id ?? TENANT_WIDE_VALUE;

  const handleChange = async (event: SelectChangeEvent) => {
    const next = event.target.value;
    setSwitching(true);
    try {
      await switchOrganization(next === TENANT_WIDE_VALUE ? undefined : next);
    } catch (error) {
      const message =
        error instanceof ApiError && error.isForbidden
          ? "You no longer have access to that organization."
          : getApiErrorMessage(error);
      notify({ message, severity: "error" });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Select
      size="small"
      value={value}
      onChange={handleChange}
      disabled={switching}
      startAdornment={<ApartmentOutlinedIcon fontSize="small" sx={{ mr: 0.5, color: "text.secondary" }} />}
      aria-label="Organization context"
      sx={{ minWidth: 200, display: { xs: "none", md: "inline-flex" } }}
    >
      <MenuItem value={TENANT_WIDE_VALUE}>Tenant-wide</MenuItem>
      {availableOrganizations.map((org) => (
        <MenuItem key={org.organizationId} value={org.organizationId}>
          {org.organizationName}
        </MenuItem>
      ))}
    </Select>
  );
}
