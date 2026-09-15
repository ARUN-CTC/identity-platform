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
import { getApiErrorMessage, type OrganizationType } from "@/shared/api";

import { useCreateOrganizationTypeMutation, useUpdateOrganizationTypeMutation } from "./hooks";

// Mirrors src/modules/organization-types/dto/create-organization-type.dto.ts.
const createSchema = z.object({
  typeCode: z.string().min(1, "Required").max(50, "Must be 50 characters or fewer"),
  typeName: z.string().min(1, "Required").max(100, "Must be 100 characters or fewer"),
  description: z.string().optional(),
  isActive: z.boolean(),
});

// Mirrors src/modules/organization-types/dto/update-organization-type.dto.ts —
// every Create field except typeCode, which cannot be changed after creation.
const editSchema = z.object({
  typeName: z.string().min(1, "Required").max(100, "Must be 100 characters or fewer"),
  description: z.string().optional(),
  isActive: z.boolean(),
});

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

export interface OrganizationTypeFormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Omit to create; pass the type being edited to switch modes. */
  organizationType?: OrganizationType;
  onSaved?: (organizationType: OrganizationType) => void;
}

export function OrganizationTypeFormDrawer({ open, onClose, organizationType, onSaved }: OrganizationTypeFormDrawerProps) {
  return organizationType ? (
    <EditOrganizationTypeForm key={organizationType.id} open={open} onClose={onClose} organizationType={organizationType} onSaved={onSaved} />
  ) : (
    <CreateOrganizationTypeForm open={open} onClose={onClose} onSaved={onSaved} />
  );
}

function CreateOrganizationTypeForm({ open, onClose, onSaved }: Omit<OrganizationTypeFormDrawerProps, "organizationType">) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useCreateOrganizationTypeMutation();

  const EMPTY: CreateFormValues = { typeCode: "", typeName: "", description: "", isActive: true };
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues>({
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
      const organizationType = await createMutation.mutateAsync({
        typeCode: values.typeCode,
        typeName: values.typeName,
        description: values.description || undefined,
        isActive: values.isActive,
      });
      notify({ message: `${values.typeName} was created successfully.`, severity: "success" });
      handleClose();
      onSaved?.(organizationType);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="New organization type" onClose={handleClose} onSubmit={onSubmit} submitLabel="Create" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField
          {...register("typeCode")}
          label="Type code"
          placeholder="BRANCH"
          fullWidth
          required
          error={!!errors.typeCode}
          helperText={errors.typeCode?.message ?? "Cannot be changed after creation."}
        />
        <TextField
          {...register("typeName")}
          label="Type name"
          placeholder="Branch"
          fullWidth
          required
          error={!!errors.typeName}
          helperText={errors.typeName?.message}
        />
        <TextField {...register("description")} label="Description" fullWidth multiline minRows={2} helperText="Optional." />
        <Controller
          name="isActive"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Checkbox {...field} checked={field.value} />}
              label="Active — selectable when creating/editing an organization"
            />
          )}
        />
      </Stack>
    </FormDrawer>
  );
}

function EditOrganizationTypeForm({
  open,
  onClose,
  organizationType,
  onSaved,
}: Required<Pick<OrganizationTypeFormDrawerProps, "organizationType">> & Omit<OrganizationTypeFormDrawerProps, "organizationType">) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const updateMutation = useUpdateOrganizationTypeMutation(organizationType.id);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      typeName: organizationType.typeName,
      description: organizationType.description ?? "",
      isActive: organizationType.isActive,
    },
  });

  const handleClose = () => {
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await updateMutation.mutateAsync({
        typeName: values.typeName,
        description: values.description || undefined,
        isActive: values.isActive,
      });
      notify({ message: `${organizationType.typeName} was updated successfully.`, severity: "success" });
      handleClose();
      onSaved?.(updated);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Edit organization type" onClose={handleClose} onSubmit={onSubmit} submitLabel="Save" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField label="Type code" value={organizationType.typeCode} fullWidth disabled helperText="Cannot be changed after creation." />
        <TextField
          {...register("typeName")}
          label="Type name"
          fullWidth
          required
          error={!!errors.typeName}
          helperText={errors.typeName?.message}
        />
        <TextField {...register("description")} label="Description" fullWidth multiline minRows={2} helperText="Optional." />
        <Controller
          name="isActive"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Checkbox {...field} checked={field.value} />}
              label="Active — selectable when creating/editing an organization"
            />
          )}
        />
      </Stack>
    </FormDrawer>
  );
}
