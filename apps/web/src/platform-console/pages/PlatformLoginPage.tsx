import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useLocation, type Location } from "react-router-dom";
import { z } from "zod";

import { ApiError } from "@/shared/api";

import { usePlatformAuth } from "../providers/PlatformAuthProvider";

const platformLoginSchema = z.object({
  email: z.string().min(1, "Required").email("Enter a valid email address"),
  password: z.string().min(1, "Required"),
});
type PlatformLoginFormValues = z.infer<typeof platformLoginSchema>;

/**
 * No tenantCode field — deliberately: a Platform Operator login never
 * resolves a tenant at all (mirrors PlatformLoginDto's own doc comment on
 * the backend). 401/423 from POST /platform/auth/login carry safe, already
 * user-facing messages (PlatformAuthenticationService deliberately
 * conflates unknown-email/wrong-password/not-an-operator into one generic
 * "Invalid credentials" to prevent enumeration, while "Account is locked…"
 * stays specific) — shown directly, not remapped by a generic error helper.
 */
function getPlatformLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) return "Network error — could not reach the server. Check your connection and try again.";
    if (error.isServerError) return "Something went wrong on our end. Please try again.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export default function PlatformLoginPage() {
  const { login } = usePlatformAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PlatformLoginFormValues>({ resolver: zodResolver(platformLoginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
      const redirectTo = (location.state as { from?: Location } | null)?.from ?? "/platform-console";
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setFormError(getPlatformLoginErrorMessage(error));
    }
  });

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate aria-label="Platform Operator sign in">
          <Stack spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Chip icon={<ShieldOutlinedIcon />} label="Platform Operator" color="default" variant="outlined" />
            <Typography variant="h4" component="h1" textAlign="center">
              Platform Console
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              This is a separate, platform-wide administration boundary — not your tenant account.
            </Typography>
          </Stack>

          {formError && (
            <Alert severity="error" role="alert">
              {formError}
            </Alert>
          )}

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
          <Button type="submit" variant="contained" size="large" fullWidth loading={isSubmitting} disabled={isSubmitting}>
            Sign in
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
