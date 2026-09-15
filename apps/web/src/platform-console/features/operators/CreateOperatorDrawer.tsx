import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { FormDrawer } from "@/design-system/components/FormDrawer";
import { ApiError, getApiErrorMessage } from "@/shared/api";

import { PLATFORM_PERMISSIONS } from "../../permissions";
import { useCreatePlatformOperatorMutation } from "./hooks";

const schema = z.object({
  email: z.string().min(1, "Required").email("Enter a valid email address"),
  permissionCodes: z.array(z.string()).min(1, "Select at least one permission"),
});
type FormValues = z.infer<typeof schema>;

const ALL_CODES = Object.values(PLATFORM_PERMISSIONS);

export function CreateOperatorDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useCreatePlatformOperatorMutation();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "", permissionCodes: [] } });

  const handleClose = () => {
    reset({ email: "", permissionCodes: [] });
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const operator = await createMutation.mutateAsync(values);
      handleClose();
      onCreated?.(operator.id);
    } catch (error) {
      // A 403 here is the real, specific grant-ceiling rejection
      // (INSUFFICIENT_PLATFORM_PRIVILEGE_TO_GRANT — you cannot grant a
      // platform permission you do not hold yourself) — bypass the
      // generic getApiErrorMessage() 403 mapping, same established fix as
      // the tenant Roles module's GrantPermissionDialog/AssignRoleDialog.
      setFormError(error instanceof ApiError && error.isForbidden ? error.message : getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Grant Platform Operator authority" onClose={handleClose} onSubmit={onSubmit} submitLabel="Grant" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField
          {...register("email")}
          label="Email"
          type="email"
          fullWidth
          required
          error={!!errors.email}
          helperText={errors.email?.message ?? "Must already be an existing, activated Identity Platform account."}
        />
        <Typography variant="subtitle2">Initial permissions</Typography>
        <Typography variant="caption" color="text.secondary">
          You can only grant permissions you hold yourself.
        </Typography>
        <Controller
          name="permissionCodes"
          control={control}
          render={({ field }) => (
            <FormGroup>
              {ALL_CODES.map((code) => (
                <FormControlLabel
                  key={code}
                  control={
                    <Checkbox
                      checked={field.value.includes(code)}
                      onChange={(e) => field.onChange(e.target.checked ? [...field.value, code] : field.value.filter((c) => c !== code))}
                    />
                  }
                  label={code}
                />
              ))}
            </FormGroup>
          )}
        />
        {errors.permissionCodes && (
          <Typography variant="caption" color="error">
            {errors.permissionCodes.message}
          </Typography>
        )}
      </Stack>
    </FormDrawer>
  );
}
