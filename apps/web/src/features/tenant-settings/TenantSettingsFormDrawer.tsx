import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useNotify } from "@/app/providers/NotificationProvider";
import { FormDrawer } from "@/design-system/components/FormDrawer";
import { getApiErrorMessage, type TenantRecord } from "@/shared/api";

import { useUpdateOwnTenantMutation } from "./hooks";

// Mirrors src/modules/tenants/dto/update-tenant.dto.ts field-for-field,
// minus `status` (see shared/api/tenants.ts's doc comment for why that's
// deliberately not exposed here).
const schema = z.object({
  tenantName: z.string().min(1, "Required").max(255, "Must be 255 characters or fewer"),
  legalName: z.string().optional(),
  email: z.union([z.string().email("Enter a valid email address"), z.literal("")]).optional(),
  phone: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export interface TenantSettingsFormDrawerProps {
  open: boolean;
  onClose: () => void;
  tenant: TenantRecord;
  onSaved?: (tenant: TenantRecord) => void;
}

export function TenantSettingsFormDrawer({ open, onClose, tenant, onSaved }: TenantSettingsFormDrawerProps) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const updateMutation = useUpdateOwnTenantMutation(tenant.id);

  const defaults: FormValues = {
    tenantName: tenant.tenantName,
    legalName: tenant.legalName ?? "",
    email: tenant.email ?? "",
    phone: tenant.phone ?? "",
  };
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });

  // Re-sync if a fresher tenant record arrives while the drawer is closed between opens.
  useEffect(() => {
    if (open) reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open with the latest tenant snapshot only
  }, [open, tenant.id]);

  const handleClose = () => {
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await updateMutation.mutateAsync({
        tenantName: values.tenantName,
        legalName: values.legalName || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
      });
      notify({ message: "Tenant settings were updated successfully.", severity: "success" });
      handleClose();
      onSaved?.(updated);
    } catch (error) {
      // No optimistic concurrency exists here (TenantsService.update() never
      // checks the `version` column) — a concurrent edit from another admin
      // is simply overwritten, last write wins. No 409 to special-case.
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Edit tenant settings" onClose={handleClose} onSubmit={onSubmit} submitLabel="Save" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField label="Tenant code" value={tenant.tenantCode} fullWidth disabled helperText="Cannot be changed." />
        <TextField
          {...register("tenantName")}
          label="Tenant name"
          fullWidth
          required
          error={!!errors.tenantName}
          helperText={errors.tenantName?.message}
        />
        <TextField {...register("legalName")} label="Legal name" fullWidth helperText="Optional." />
        <TextField
          {...register("email")}
          label="Email"
          type="email"
          fullWidth
          error={!!errors.email}
          helperText={errors.email?.message ?? "Optional."}
        />
        <TextField {...register("phone")} label="Phone" fullWidth helperText="Optional." />
      </Stack>
    </FormDrawer>
  );
}
