import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link as RouterLink, useLocation, useNavigate, type Location } from "react-router-dom";

import { useAuth } from "@/app/providers/AuthProvider";
import { ApiError } from "@/shared/api";

import { emptyLoginFormValues, loginFormSchema, type LoginFormValues } from "./loginFormSchema";

/**
 * 401/403 from POST /auth/login carry safe, specific, user-facing messages
 * already (see AuthenticationService — "Invalid credentials" deliberately
 * conflates unknown-tenant/unknown-email/wrong-password to prevent account
 * enumeration, while "Account is locked..."/"Account is {status}" stay
 * specific). Bypasses the generic getApiErrorMessage(), whose 403 → "You
 * don't have permission to do that." mapping would be wrong here.
 */
function getLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) return "Network error — could not reach the server. Check your connection and try again.";
    if (error.isServerError) return "Something went wrong on our end. Please try again.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
      await login(values);
      const redirectTo = (location.state as { from?: Location } | null)?.from ?? "/dashboard";
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setFormError(getLoginErrorMessage(error));
    }
  });

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate aria-label="Sign in">
          <Stack spacing={0.5} sx={{ mb: 0.5 }}>
            <Typography variant="h4" component="h1" textAlign="center">
              Welcome back
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Sign in to your workspace to continue
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
      </CardContent>
    </Card>
  );
}
