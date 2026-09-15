import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { z } from "zod";

import { FormDrawer } from "@/design-system/components/FormDrawer";
import { useNotify } from "@/app/providers/NotificationProvider";
import { getApiErrorMessage, type Role } from "@/shared/api";

import { useCreateRoleMutation, useUpdateRoleMutation } from "./hooks";

// Mirrors src/modules/roles/dto/create-role.dto.ts
const createSchema = z.object({
  roleCode: z
    .string()
    .min(1, "Required")
    .max(50, "Must be 50 characters or fewer")
    .regex(/^[A-Z0-9_]+$/, "Must be UPPER_SNAKE_CASE"),
  roleName: z.string().min(1, "Required").max(100, "Must be 100 characters or fewer"),
  description: z.string().optional(),
});
const editSchema = createSchema.omit({ roleCode: true });

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

export interface RoleFormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Omit to create; pass the role being edited to switch modes. Never pass a system role — RolesDetailsPage only offers Edit for non-system roles (the backend rejects it with 400 SYSTEM_ROLE_IMMUTABLE regardless). */
  role?: Role;
  onSaved?: (role: Role) => void;
}

export function RoleFormDrawer({ open, onClose, role, onSaved }: RoleFormDrawerProps) {
  return role ? (
    <EditRoleForm key={role.id} open={open} onClose={onClose} role={role} onSaved={onSaved} />
  ) : (
    <CreateRoleForm open={open} onClose={onClose} onSaved={onSaved} />
  );
}

function CreateRoleForm({ open, onClose, onSaved }: Omit<RoleFormDrawerProps, "role">) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useCreateRoleMutation();

  const EMPTY: CreateFormValues = { roleCode: "", roleName: "", description: "" };
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: EMPTY,
  });

  const handleClose = () => {
    reset(EMPTY);
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const role = await createMutation.mutateAsync({
        roleCode: values.roleCode,
        roleName: values.roleName,
        description: values.description || undefined,
      });
      notify({ message: `${values.roleName} was created successfully.`, severity: "success" });
      handleClose();
      onSaved?.(role);
    } catch (error) {
      // A duplicate roleCode within this tenant surfaces as a real,
      // user-facing error (see the tenant/role uniqueness constraint).
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="New role" onClose={handleClose} onSubmit={onSubmit} submitLabel="Create" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField
          {...register("roleCode")}
          label="Role code"
          placeholder="BILLING_MANAGER"
          fullWidth
          required
          error={!!errors.roleCode}
          helperText={errors.roleCode?.message ?? "UPPER_SNAKE_CASE. Cannot be changed after creation."}
        />
        <TextField {...register("roleName")} label="Role name" fullWidth required error={!!errors.roleName} helperText={errors.roleName?.message} />
        <TextField {...register("description")} label="Description" fullWidth multiline minRows={2} helperText="Optional." />
      </Stack>
    </FormDrawer>
  );
}

function EditRoleForm({ open, onClose, role, onSaved }: Required<Pick<RoleFormDrawerProps, "role">> & Omit<RoleFormDrawerProps, "role">) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const updateMutation = useUpdateRoleMutation(role.id);

  const defaults: EditFormValues = { roleName: role.roleName, description: role.description ?? "" };
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: defaults,
  });

  const handleClose = () => {
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await updateMutation.mutateAsync({ roleName: values.roleName, description: values.description || undefined });
      notify({ message: `${values.roleName} was updated successfully.`, severity: "success" });
      handleClose();
      onSaved?.(updated);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Edit role" onClose={handleClose} onSubmit={onSubmit} submitLabel="Save" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField label="Role code" value={role.roleCode} fullWidth disabled helperText="Cannot be changed after creation." />
        <TextField {...register("roleName")} label="Role name" fullWidth required error={!!errors.roleName} helperText={errors.roleName?.message} />
        <TextField {...register("description")} label="Description" fullWidth multiline minRows={2} helperText="Optional." />
      </Stack>
    </FormDrawer>
  );
}
