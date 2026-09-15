import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormDrawer } from "@/design-system/components/FormDrawer";
import { getApiErrorMessage } from "@/shared/api";

import { useCreatePlatformTenantMutation } from "./hooks";

// Mirrors src/modules/tenants/dto/create-tenant.dto.ts.
const schema = z.object({
  tenantCode: z.string().min(1, "Required").max(64, "Must be 64 characters or fewer"),
  tenantName: z.string().min(1, "Required").max(255, "Must be 255 characters or fewer"),
  legalName: z.string().optional(),
  email: z.union([z.string().email("Enter a valid email address"), z.literal("")]).optional(),
  phone: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;
const EMPTY: FormValues = { tenantCode: "", tenantName: "", legalName: "", email: "", phone: "" };

export interface PlatformTenantFormDrawerProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (tenantId: string) => void;
}

/** Created directly PROVISIONING — TenantsRepository.create() sets that status unconditionally, never accepts one as input. */
export function PlatformTenantFormDrawer({ open, onClose, onCreated }: PlatformTenantFormDrawerProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useCreatePlatformTenantMutation();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const handleClose = () => {
    reset(EMPTY);
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const tenant = await createMutation.mutateAsync({
        tenantCode: values.tenantCode,
        tenantName: values.tenantName,
        legalName: values.legalName || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
      });
      handleClose();
      onCreated?.(tenant.id);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Register tenant" onClose={handleClose} onSubmit={onSubmit} submitLabel="Create" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField {...register("tenantCode")} label="Tenant code" fullWidth required error={!!errors.tenantCode} helperText={errors.tenantCode?.message ?? "Cannot be changed after creation."} />
        <TextField {...register("tenantName")} label="Tenant name" fullWidth required error={!!errors.tenantName} helperText={errors.tenantName?.message} />
        <TextField {...register("legalName")} label="Legal name" fullWidth helperText="Optional." />
        <TextField {...register("email")} label="Email" type="email" fullWidth error={!!errors.email} helperText={errors.email?.message ?? "Optional."} />
        <TextField {...register("phone")} label="Phone" fullWidth helperText="Optional." />
      </Stack>
    </FormDrawer>
  );
}
