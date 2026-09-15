import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link as RouterLink, useSearchParams } from "react-router-dom";

import { getApiErrorMessage, resetPassword } from "@/shared/api";

import {
  emptyResetPasswordFormValues,
  resetPasswordFormSchema,
  type ResetPasswordFormValues,
} from "./resetPasswordFormSchema";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: emptyResetPasswordFormValues,
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setFormError(null);
    try {
      await resetPassword({ token, newPassword: values.newPassword });
      setSubmitted(true);
    } catch (error) {
      setFormError(getApiErrorMessage(error));
    }
  });

  if (!token) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2} alignItems="center" textAlign="center">
            <Typography variant="h4" component="h1">
              Invalid link
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This password reset link is missing its token. Request a new one below.
            </Typography>
            <Link component={RouterLink} to="/forgot-password" variant="body2" underline="hover">
              Request a new reset link
            </Link>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (submitted) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2} alignItems="center" textAlign="center">
            <Typography variant="h4" component="h1">
              Password reset
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your password has been changed. You've been signed out everywhere else — sign in again with your new
              password.
            </Typography>
            <Button component={RouterLink} to="/login" variant="contained">
              Sign in
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate aria-label="Choose a new password">
          <Stack spacing={0.5} sx={{ mb: 0.5 }}>
            <Typography variant="h4" component="h1" textAlign="center">
              Choose a new password
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Must be at least 8 characters.
            </Typography>
          </Stack>

          {formError && (
            <Alert severity="error" role="alert">
              {formError}
            </Alert>
          )}

          <TextField
            {...register("newPassword")}
            label="New password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            fullWidth
            required
            error={!!errors.newPassword}
            helperText={errors.newPassword?.message}
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
          <TextField
            {...register("confirmPassword")}
            label="Confirm new password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            fullWidth
            required
            error={!!errors.confirmPassword}
            helperText={errors.confirmPassword?.message}
            slotProps={{ htmlInput: { "aria-required": true } }}
          />
          <Button type="submit" variant="contained" size="large" fullWidth loading={isSubmitting} disabled={isSubmitting}>
            Reset password
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
