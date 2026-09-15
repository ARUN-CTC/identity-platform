import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";
import { z } from "zod";

import { FormDrawer } from "@/design-system/components/FormDrawer";
import { useNotify } from "@/app/providers/NotificationProvider";
import { getApiErrorMessage, type Permission } from "@/shared/api";

import { useCreatePermissionMutation, useUpdatePermissionMutation } from "./hooks";

// Mirrors src/modules/permissions/dto/create-permission.dto.ts. There is no
// `platformOnly` field — the API has no way to set it; every permission
// created here is a normal, tenant-grantable one.
const createSchema = z.object({
  permissionCode: z
    .string()
    .min(1, "Required")
    .max(100, "Must be 100 characters or fewer")
    .regex(/^[A-Z0-9_]+$/, "Must be UPPER_SNAKE_CASE"),
  resource: z.string().min(1, "Required").max(50, "Must be 50 characters or fewer"),
  action: z.string().min(1, "Required").max(30, "Must be 30 characters or fewer"),
  description: z.string().optional(),
  isSystem: z.boolean(),
});

// Mirrors src/modules/permissions/dto/update-permission.dto.ts exactly —
// description is the only field the backend accepts on update.
const editSchema = z.object({ description: z.string().optional() });

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

export interface PermissionFormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Omit to create; pass the permission being edited to switch modes (edit only ever changes description — see editSchema's own comment). */
  permission?: Permission;
  onSaved?: (permission: Permission) => void;
}

export function PermissionFormDrawer({ open, onClose, permission, onSaved }: PermissionFormDrawerProps) {
  return permission ? (
    <EditPermissionForm key={permission.id} open={open} onClose={onClose} permission={permission} onSaved={onSaved} />
  ) : (
    <CreatePermissionForm open={open} onClose={onClose} onSaved={onSaved} />
  );
}

function CreatePermissionForm({ open, onClose, onSaved }: Omit<PermissionFormDrawerProps, "permission">) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useCreatePermissionMutation();

  const EMPTY: CreateFormValues = { permissionCode: "", resource: "", action: "", description: "", isSystem: true };
  const { control, register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CreateFormValues>({
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
      const permission = await createMutation.mutateAsync({
        permissionCode: values.permissionCode,
        resource: values.resource,
        action: values.action,
        description: values.description || undefined,
        isSystem: values.isSystem,
      });
      notify({ message: `${values.permissionCode} was created successfully.`, severity: "success" });
      handleClose();
      onSaved?.(permission);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="New permission" onClose={handleClose} onSubmit={onSubmit} submitLabel="Create" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField
          {...register("permissionCode")}
          label="Permission code"
          placeholder="REPORT_VIEW"
          fullWidth
          required
          error={!!errors.permissionCode}
          helperText={errors.permissionCode?.message ?? "UPPER_SNAKE_CASE, RESOURCE_ACTION format. Identity fields cannot be changed after creation."}
        />
        <TextField {...register("resource")} label="Resource" placeholder="REPORT" fullWidth required error={!!errors.resource} helperText={errors.resource?.message} />
        <TextField {...register("action")} label="Action" placeholder="VIEW" fullWidth required error={!!errors.action} helperText={errors.action?.message} />
        <TextField {...register("description")} label="Description" fullWidth multiline minRows={2} helperText="Optional." />
        <Controller
          name="isSystem"
          control={control}
          render={({ field }) => (
            <FormControlLabel control={<Checkbox {...field} checked={field.value} />} label="System permission" />
          )}
        />
      </Stack>
    </FormDrawer>
  );
}

function EditPermissionForm({ open, onClose, permission, onSaved }: Required<Pick<PermissionFormDrawerProps, "permission">> & Omit<PermissionFormDrawerProps, "permission">) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const updateMutation = useUpdatePermissionMutation(permission.id);

  const { register, handleSubmit, formState: { isSubmitting } } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { description: permission.description ?? "" },
  });

  const handleClose = () => {
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await updateMutation.mutateAsync({ description: values.description || undefined });
      notify({ message: `${permission.permissionCode} was updated successfully.`, severity: "success" });
      handleClose();
      onSaved?.(updated);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Edit permission" onClose={handleClose} onSubmit={onSubmit} submitLabel="Save" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField label="Permission code" value={permission.permissionCode} fullWidth disabled />
        <TextField label="Resource" value={permission.resource} fullWidth disabled />
        <TextField label="Action" value={permission.action} fullWidth disabled />
        <TextField
          {...register("description")}
          label="Description"
          fullWidth
          multiline
          minRows={2}
          helperText="The only field that can be changed after creation — see this permission's own identity fields above."
        />
      </Stack>
    </FormDrawer>
  );
}
