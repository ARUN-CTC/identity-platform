import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";
import { z } from "zod";

import { Modal } from "@/design-system/components/Modal";
import { PERMISSIONS } from "@/shared/auth/permissions";
import { usePermission } from "@/shared/hooks";
import { ApiError, getApiErrorMessage } from "@/shared/api";

import { useAssignRoleMutation, useOrganizationsLookupQuery, useRolesLookupQuery } from "./hooks";

const TENANT_WIDE_VALUE = "__tenant_wide__";

const assignRoleFormSchema = z.object({
  roleId: z.string().min(1, "Select a role"),
  organizationId: z.string(),
});

type AssignRoleFormValues = z.infer<typeof assignRoleFormSchema>;

export interface AssignRoleDialogProps {
  open: boolean;
  userId: string;
  onClose: () => void;
}

/**
 * The backend re-checks two things this dialog cannot know client-side
 * (see UserRolesService): the caller must already hold every permission
 * the chosen role carries (ROLE-SECURITY-001 — prevents privilege
 * escalation even from an otherwise-authorized USER_MANAGE holder), and
 * the grantee must have an active membership backing whatever scope is
 * chosen. Both surface as real, specific errors here rather than being
 * pre-validated client-side.
 */
export function AssignRoleDialog({ open, userId, onClose }: AssignRoleDialogProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const rolesQuery = useRolesLookupQuery();
  const canSeeOrganizations = usePermission(PERMISSIONS.ORGANIZATION_MANAGE);
  const organizationsQuery = useOrganizationsLookupQuery(canSeeOrganizations && open);
  const assignMutation = useAssignRoleMutation(userId);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignRoleFormValues>({
    resolver: zodResolver(assignRoleFormSchema),
    defaultValues: { roleId: "", organizationId: TENANT_WIDE_VALUE },
  });

  const handleClose = () => {
    reset();
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await assignMutation.mutateAsync({
        roleId: values.roleId,
        organizationId: values.organizationId === TENANT_WIDE_VALUE ? undefined : values.organizationId,
      });
      handleClose();
    } catch (error) {
      // INSUFFICIENT_PRIVILEGE_TO_GRANT (403) — the caller doesn't hold
      // every permission this role carries themselves (see
      // UserRolesService.assertCallerCanGrant() — unlike role→permission
      // grants, there is no TENANT_MANAGE bypass here). Bypasses
      // getApiErrorMessage()'s generic 403 mapping, which would swallow
      // that specific, already-user-safe backend message — a 403 here is
      // always that grant-ceiling rejection, never a bare route-access
      // denial (opening this dialog already required USER_MANAGE).
      setFormError(error instanceof ApiError && error.isForbidden ? error.message : getApiErrorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      title="Assign role"
      onClose={handleClose}
      actions={
        <>
          <Button onClick={handleClose} color="inherit" disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} variant="contained" loading={isSubmitting} disabled={isSubmitting}>
            Assign
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}

        <Controller
          name="roleId"
          control={control}
          render={({ field }) => (
            <FormControl fullWidth error={!!errors.roleId} disabled={rolesQuery.isLoading}>
              <InputLabel id="assign-role-select-label">Role</InputLabel>
              <Select {...field} labelId="assign-role-select-label" label="Role">
                {rolesQuery.data?.items.map((role) => (
                  <MenuItem key={role.id} value={role.id}>
                    {role.roleName}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                {errors.roleId?.message ?? "Granting a role immediately applies its full permission set."}
              </FormHelperText>
            </FormControl>
          )}
        />

        <Controller
          name="organizationId"
          control={control}
          render={({ field }) => (
            <FormControl fullWidth disabled={!canSeeOrganizations || organizationsQuery.isLoading}>
              <InputLabel id="assign-role-org-select-label">Scope</InputLabel>
              <Select {...field} labelId="assign-role-org-select-label" label="Scope">
                <MenuItem value={TENANT_WIDE_VALUE}>Tenant-wide</MenuItem>
                {organizationsQuery.data?.items.map((org) => (
                  <MenuItem key={org.id} value={org.id}>
                    {org.organizationName}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                {canSeeOrganizations
                  ? "Scope this grant to one organization, or leave it tenant-wide."
                  : "Organization-scoped grants require the Organizations permission — this grant will be tenant-wide."}
              </FormHelperText>
            </FormControl>
          )}
        />
      </Stack>
    </Modal>
  );
}
