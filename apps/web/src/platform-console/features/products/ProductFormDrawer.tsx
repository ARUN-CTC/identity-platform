import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormDrawer } from "@/design-system/components/FormDrawer";
import { getApiErrorMessage } from "@/shared/api";

import { useCreatePlatformProductMutation } from "./hooks";

// Mirrors src/modules/products/dto/create-product.dto.ts
const schema = z.object({
  name: z.string().min(1, "Required").max(200, "Must be 200 characters or fewer"),
  slug: z
    .string()
    .min(1, "Required")
    .max(50, "Must be 50 characters or fewer")
    .regex(/^[a-z][a-z0-9-]*$/, "Lowercase letters, digits, and hyphens, starting with a letter"),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;
const EMPTY: FormValues = { name: "", slug: "", description: "" };

export function ProductFormDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useCreatePlatformProductMutation();
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
      const product = await createMutation.mutateAsync(values);
      handleClose();
      onCreated?.(product.id);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Register product" onClose={handleClose} onSubmit={onSubmit} submitLabel="Create" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField {...register("name")} label="Name" fullWidth required error={!!errors.name} helperText={errors.name?.message} />
        <TextField {...register("slug")} label="Slug" fullWidth required error={!!errors.slug} helperText={errors.slug?.message ?? "Cannot be changed after creation. Also the OAuth scope namespace prefix."} />
        <TextField {...register("description")} label="Description" fullWidth multiline minRows={2} helperText="Optional." />
      </Stack>
    </FormDrawer>
  );
}
