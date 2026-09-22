import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { useNotify } from "@/app/providers/NotificationProvider";
import { FormDrawer } from "@/design-system/components/FormDrawer";
import { getApiErrorMessage } from "@/shared/api";
import type { PlatformApplication } from "@/shared/platform-api";

import { useUpdateApplicationMutation } from "./hooks";

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Editable via PATCH /applications/:id (UpdateApplicationDto) — everything
 * except `name`/`status` (already editable elsewhere on the detail page)
 * and clientType/productId (immutable after creation — the backend rejects
 * `productId` outright with a 400, and there is no field for clientType at
 * all on this DTO). Mirrors ApplicationFormDrawer's own create-time schema
 * and comma-list convention exactly, so editing looks and behaves like
 * registration did.
 */
const schema = z.object({
  authorizationCode: z.boolean(),
  clientCredentials: z.boolean(),
  redirectUris: z.string().optional(),
  allowedOrigins: z.string().optional(),
  allowedScopes: z.string().optional(),
  audiences: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export interface ApplicationConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  application: PlatformApplication;
  /** This Application's owning Product's slug — the namespace every non-OIDC-standard scope must fall under (ApplicationScopePolicy). Shown in the scopes field's helper text so the rule is visible, not just enforced after the fact. */
  productSlug: string;
}

export function ApplicationConfigDrawer({ open, onClose, application, productSlug }: ApplicationConfigDrawerProps) {
  const notify = useNotify();
  const [formError, setFormError] = useState<string | null>(null);
  const updateMutation = useUpdateApplicationMutation(application.id, application.productId);

  const defaultValues: FormValues = {
    authorizationCode: application.grantTypes.includes("authorization_code"),
    clientCredentials: application.grantTypes.includes("client_credentials"),
    redirectUris: application.redirectUris.join(", "),
    allowedOrigins: application.allowedOrigins.join(", "),
    allowedScopes: application.allowedScopes.join(", "),
    audiences: application.audiences.join(", "),
  };

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues });

  const handleClose = () => {
    reset(defaultValues);
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const grantTypes = [...(values.authorizationCode ? (["authorization_code"] as const) : []), ...(values.clientCredentials ? (["client_credentials"] as const) : [])];
    try {
      await updateMutation.mutateAsync({
        grantTypes,
        redirectUris: parseCommaList(values.redirectUris ?? ""),
        allowedOrigins: parseCommaList(values.allowedOrigins ?? ""),
        allowedScopes: parseCommaList(values.allowedScopes ?? ""),
        audiences: parseCommaList(values.audiences ?? ""),
      });
      notify({ message: `${application.name}'s configuration was updated successfully.`, severity: "success" });
      handleClose();
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  return (
    <FormDrawer open={open} title="Edit configuration" onClose={handleClose} onSubmit={onSubmit} submitLabel="Save" submitting={isSubmitting}>
      <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert severity="error">{formError}</Alert>}
        <Typography variant="body2" color="text.secondary">
          Client type ({application.clientType}) cannot be changed after registration.
        </Typography>
        <FormControl>
          <FormLabel>Grant types</FormLabel>
          <Controller
            name="authorizationCode"
            control={control}
            render={({ field }) => <FormControlLabel control={<Checkbox {...field} checked={field.value} />} label="authorization_code (human user, PKCE)" />}
          />
          <Controller
            name="clientCredentials"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Checkbox {...field} checked={field.value} disabled={application.clientType === "PUBLIC"} />}
                label={application.clientType === "PUBLIC" ? "client_credentials (requires a Confidential client)" : "client_credentials (ServiceAccount)"}
              />
            )}
          />
        </FormControl>
        <TextField {...register("redirectUris")} label="Redirect URIs" fullWidth helperText="Comma-separated. HTTPS required except localhost. Required if authorization_code is checked." />
        <TextField {...register("allowedOrigins")} label="Allowed origins (CORS)" fullWidth helperText="Comma-separated. Optional." />
        <TextField
          {...register("allowedScopes")}
          label="Allowed scopes"
          fullWidth
          helperText={`Comma-separated. Standard OIDC scopes (openid, profile, email) or namespaced under this product's own slug ('${productSlug}.').`}
        />
        <TextField
          {...register("audiences")}
          label="Audiences"
          fullWidth
          helperText="Comma-separated resource-API identifiers this app may request a token for. No wildcards. An audience is NOT the client ID, a scope, or a permission — without at least one, every login attempt for this application fails at /oauth/authorize."
        />
      </Stack>
    </FormDrawer>
  );
}
