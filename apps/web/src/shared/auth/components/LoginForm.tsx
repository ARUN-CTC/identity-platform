import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link as RouterLink } from "react-router-dom";

import { useAuth, type LoginResult } from "@/app/providers/AuthProvider";
import { getAuthErrorMessage } from "@/shared/auth/authErrorMessages";

import { emptyLoginFormValues, loginFormSchema, type LoginFormValues } from "@/app/pages/loginFormSchema";

export interface LoginFormProps {
  /** Defaults to "Welcome back" — overridden by the OAuth authorization shell to show product context instead (brief §7). */
  title?: string;
  subtitle?: string;
  /** Called with the freshly-established session state right after a successful sign-in — never called on failure. The form does not navigate itself; the caller decides where to go (brief §12's org-selection routing lives in the caller, not here, since only the caller knows the eventual destination). */
  onSuccess: (result: LoginResult) => void;
}

/**
 * The one login form — used standalone by LoginPage and inline by
 * OAuthAuthorizePage's "please sign in to continue" step (brief §22 names
 * this component explicitly). Extracted from LoginPage unchanged in
 * behavior; LoginPage.tsx is now a thin wrapper providing the post-login
 * navigation decision.
 */
export function LoginForm({ title = "Welcome back", subtitle = "Sign in to your workspace to continue", onSuccess }: LoginFormProps) {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: emptyLoginFormValues,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await login(values);
      onSuccess(result);
    } catch (error) {
      setFormError(getAuthErrorMessage(error));
    }
  });

  return (
    <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate aria-label="Sign in">
      <Stack spacing={0.5} sx={{ mb: 0.5 }}>
        <Typography variant="h4" component="h1" textAlign="center">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          {subtitle}
        </Typography>
      </Stack>

      {formError && (
        <Alert severity="error" role="alert">
          {formError}
        </Alert>
      )}

      <TextField
        {...register("tenantCode")}
        label="Tenant code"
        placeholder="ACME"
        autoComplete="organization"
        fullWidth
        required
        error={!!errors.tenantCode}
        helperText={errors.tenantCode?.message ?? "Your organization's Identity Platform code — ask your administrator if you're not sure."}
        slotProps={{ htmlInput: { "aria-required": true } }}
      />
      <TextField
        {...register("email")}
        label="Email"
        type="email"
        autoComplete="username"
        fullWidth
        required
        error={!!errors.email}
        helperText={errors.email?.message}
        slotProps={{ htmlInput: { "aria-required": true } }}
      />
      <TextField
        {...register("password")}
        label="Password"
        type={showPassword ? "text" : "password"}
        autoComplete="current-password"
        fullWidth
        required
        error={!!errors.password}
        helperText={errors.password?.message}
        slotProps={{
          htmlInput: { "aria-required": true },
          input: {
            endAdornment: (
              <IconButton
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                edge="end"
                size="small"
              >
                {showPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
              </IconButton>
            ),
          },
        }}
      />
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Controller
          name="rememberMe"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Checkbox {...field} checked={field.value} size="small" />}
              label={<Typography variant="body2">Remember me</Typography>}
            />
          )}
        />
        <Link component={RouterLink} to="/forgot-password" variant="body2" underline="hover">
          Forgot password?
        </Link>
      </Stack>
      <Button type="submit" variant="contained" size="large" fullWidth loading={isSubmitting} disabled={isSubmitting}>
        Sign in
      </Button>
    </Stack>
  );
}
