import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link as RouterLink } from "react-router-dom";

import { forgotPassword, getApiErrorMessage } from "@/shared/api";

import {
  emptyForgotPasswordFormValues,
  forgotPasswordFormSchema,
  type ForgotPasswordFormValues,
} from "./forgotPasswordFormSchema";

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: emptyForgotPasswordFormValues,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await forgotPassword(values);
      // The backend always responds this way regardless of whether the
      // account exists — never reveal which emails have accounts.
      setSubmitted(true);
    } catch (error) {
      // Only a real failure to reach the backend (network/server error)
      // surfaces here — a "no such account" outcome is indistinguishable
      // from success by design (see the backend's own forgotPassword()).
      setFormError(getApiErrorMessage(error));
    }
  });

  if (submitted) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2} alignItems="center" textAlign="center">
            <Typography variant="h4" component="h1">
              Check your email
            </Typography>
            <Typography variant="body2" color="text.secondary">
              If an account matches the tenant code and email you entered, we've sent a link to reset your password.
            </Typography>
            <Link component={RouterLink} to="/login" variant="body2" underline="hover">
              Back to sign in
            </Link>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate aria-label="Reset your password">
          <Stack spacing={0.5} sx={{ mb: 0.5 }}>
            <Typography variant="h4" component="h1" textAlign="center">
              Forgot your password?
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Enter your tenant code and email and we'll send you a reset link.
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
            helperText={errors.tenantCode?.message}
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
          <Button type="submit" variant="contained" size="large" fullWidth loading={isSubmitting} disabled={isSubmitting}>
            Send reset link
          </Button>
          <Link component={RouterLink} to="/login" variant="body2" underline="hover" textAlign="center">
            Back to sign in
          </Link>
        </Stack>
      </CardContent>
    </Card>
  );
}
