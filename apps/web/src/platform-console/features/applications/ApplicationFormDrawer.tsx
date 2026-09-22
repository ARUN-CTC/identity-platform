import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { FormDrawer } from "@/design-system/components/FormDrawer";
import { getApiErrorMessage } from "@/shared/api";
import type { CreatedApplication } from "@/shared/platform-api";

import { useCreateApplicationMutation } from "./hooks";

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

// Mirrors src/modules/applications/dto/create-application.dto.ts +
// GRANT_TYPES (only authorization_code/client_credentials exist).
const schema = z.object({
  name: z.string().min(1, "Required").max(200, "Must be 200 characters or fewer"),
  clientType: z.enum(["CONFIDENTIAL", "PUBLIC"]),
  authorizationCode: z.boolean(),
  clientCredentials: z.boolean(),
  redirectUris: z.string().optional(),
  allowedOrigins: z.string().optional(),
  allowedScopes: z.string().optional(),
  audiences: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;
const EMPTY: FormValues = { name: "", clientType: "CONFIDENTIAL", authorizationCode: false, clientCredentials: false, redirectUris: "", allowedOrigins: "", allowedScopes: "", audiences: "" };

export function ApplicationFormDrawer({ open, onClose, productId, onCreated }: { open: boolean; onClose: () => void; productId: string; onCreated?: (app: CreatedApplication) => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useCreateApplicationMutation(productId);
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const clientType = watch("clientType");

  const handleClose = () => {
    reset(EMPTY);
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const grantTypes = [...(values.authorizationCode ? (["authorization_code"] as const) : []), ...(values.clientCredentials ? (["client_credentials"] as const) : [])];
    try {
      const application = await createMutation.mutateAsync({
        name: values.name,
        clientType: values.clientType,
        grantTypes,
        redirectUris: parseCommaList(values.redirectUris ?? ""),
        allowedOrigins: parseCommaList(values.allowedOrigins ?? ""),
        allowedScopes: parseCommaList(values.allowedScopes ?? ""),
        audiences: parseCommaList(values.audiences ?? ""),
      });
      handleClose();
      onCreated?.(application);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Register application" onClose={handleClose} onSubmit={onSubmit} submitLabel="Create" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <TextField {...register("name")} label="Name" fullWidth required error={!!errors.name} helperText={errors.name?.message} />
        <Controller
          name="clientType"
          control={control}
          render={({ field }) => (
            <FormControl fullWidth>
              <InputLabel id="client-type-label">Client type</InputLabel>
              <Select {...field} labelId="client-type-label" label="Client type">
                <MenuItem value="CONFIDENTIAL">Confidential (gets a client secret)</MenuItem>
                <MenuItem value="PUBLIC">Public (no secret — PKCE only)</MenuItem>
              </Select>
            </FormControl>
          )}
        />
        <FormControl>
          <FormLabel>Grant types</FormLabel>
          <Controller name="authorizationCode" control={control} render={({ field }) => <FormControlLabel control={<Checkbox {...field} checked={field.value} />} label="authorization_code (human user, PKCE)" />} />
          <Controller
            name="clientCredentials"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Checkbox {...field} checked={field.value} disabled={clientType === "PUBLIC"} />}
                label={clientType === "PUBLIC" ? "client_credentials (requires a Confidential client)" : "client_credentials (ServiceAccount)"}
              />
            )}
          />
        </FormControl>
        <TextField {...register("redirectUris")} label="Redirect URIs" fullWidth helperText="Comma-separated. HTTPS required except localhost. Required if authorization_code is checked." />
        <TextField {...register("allowedOrigins")} label="Allowed origins (CORS)" fullWidth helperText="Comma-separated. Optional." />
        <TextField {...register("allowedScopes")} label="Allowed scopes" fullWidth helperText={`Comma-separated. Standard OIDC scopes (openid, profile, email) or namespaced under this product's own slug.`} />
        <TextField
          {...register("audiences")}
          label="Audiences"
          fullWidth
          helperText="Comma-separated resource-API identifiers this app may request a token for. An audience is NOT the client ID, a scope, or a permission — it names WHICH resource server the token is for; without at least one, /oauth/authorize rejects every login attempt for this application."
        />
      </Stack>
    </FormDrawer>
  );
}
