import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import { Modal } from "@/design-system/components/Modal";
import { ApiError, getApiErrorMessage, type Permission, type RolePermissionGrant } from "@/shared/api";

import { useGrantPermissionMutation, usePermissionsLookupQuery } from "./hooks";

export interface GrantPermissionDialogProps {
  open: boolean;
  onClose: () => void;
  roleId: string;
  /** So an already-granted permission (and every platform-only one — see below) is excluded from the picker. */
  currentGrants: RolePermissionGrant[];
}

/**
 * Platform-only permissions are excluded from this picker as a UX
 * courtesy only — attaching one to a tenant role always fails (a DB
 * trigger, trg_security_role_permission_no_platform_only, unconditionally
 * blocks it; see shared/api/roles.ts's own doc comment on
 * grantRolePermission). This filter is never the actual security
 * boundary — even if it were bypassed, the backend still rejects the
 * attempt (today as an opaque 500, a real gap this module documents
 * rather than papers over).
 */
export function GrantPermissionDialog({ open, onClose, roleId, currentGrants }: GrantPermissionDialogProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Permission | null>(null);
  const permissionsQuery = usePermissionsLookupQuery();
  const grantMutation = useGrantPermissionMutation(roleId);

  const grantedIds = useMemo(() => new Set(currentGrants.map((g) => g.permissionId)), [currentGrants]);
  const options = useMemo(
    () => (permissionsQuery.data?.items ?? []).filter((p) => !p.platformOnly && !grantedIds.has(p.id)),
    [permissionsQuery.data, grantedIds],
  );

  const handleClose = () => {
    setSelected(null);
    setFormError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setFormError(null);
    try {
      await grantMutation.mutateAsync(selected.id);
      handleClose();
    } catch (error) {
      // INSUFFICIENT_PRIVILEGE_TO_GRANT (403) — the caller doesn't hold
      // this permission themselves and doesn't hold TENANT_MANAGE either
      // (see grantRolePermission's own doc comment on the real rule).
      // getApiErrorMessage()'s generic 403 mapping ("You don't have
      // permission to do that.") would swallow that specific, actionable,
      // already-user-safe backend message (see AllExceptionsFilter) — a
      // 403 reaching this dialog is always that specific grant-ceiling
      // rejection, never a bare route-access denial (opening this dialog
      // at all already required ROLE_MANAGE), so showing it verbatim is
      // both correct and safe here.
      setFormError(error instanceof ApiError && error.isForbidden ? error.message : getApiErrorMessage(error));
    }
  };

  return (
    <Modal
      open={open}
      title="Grant permission"
      onClose={handleClose}
      actions={
        <>
          <Button onClick={handleClose} color="inherit" disabled={grantMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} variant="contained" disabled={!selected || grantMutation.isPending} loading={grantMutation.isPending}>
            Grant
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        {formError && <Alert severity="error">{formError}</Alert>}
        <Autocomplete
          options={options}
          loading={permissionsQuery.isLoading}
          getOptionLabel={(option) => option.permissionCode}
          value={selected}
          onChange={(_event, value) => setSelected(value)}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => <TextField {...params} label="Permission" />}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <Stack>
                <Typography variant="body2">{option.permissionCode}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {option.resource} · {option.action}
                </Typography>
              </Stack>
            </li>
          )}
        />
        <Typography variant="caption" color="text.secondary">
          Granting immediately applies this permission to every user holding this role. You can only grant a
          permission you already hold yourself, unless you hold TENANT_MANAGE.
        </Typography>
      </Stack>
    </Modal>
  );
}
