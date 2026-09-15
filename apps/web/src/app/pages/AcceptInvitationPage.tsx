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
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link as RouterLink, useSearchParams } from "react-router-dom";

import { ErrorState } from "@/design-system/components/ErrorState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { acceptInvitation, getApiErrorMessage, validateInvitation, type ValidateInvitationResult } from "@/shared/api";

import {
  acceptInvitationFormSchema,
  emptyAcceptInvitationFormValues,
  type AcceptInvitationFormValues,
} from "./acceptInvitationFormSchema";

export default function AcceptInvitationPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [validation, setValidation] = useState<
    { status: "loading" } | { status: "invalid" } | { status: "valid"; invite: ValidateInvitationResult }
  >({ status: "loading" });

  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInvitationFormValues>({
    resolver: zodResolver(acceptInvitationFormSchema),
    defaultValues: emptyAcceptInvitationFormValues,
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    validateInvitation(token)
      .then((invite) => {
        if (!cancelled) setValidation({ status: "valid", invite });
      })
      .catch(() => {
        if (!cancelled) setValidation({ status: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setFormError(null);
    try {
      await acceptInvitation({ token, password: values.password });
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
              This invitation link is missing its token. Ask whoever invited you to resend it.
            </Typography>
            <Link component={RouterLink} to="/login" variant="body2" underline="hover">
              Back to sign in
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
              You're all set
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your account is active. Sign in with your new password to get started.
            </Typography>
            <Button component={RouterLink} to="/login" variant="contained">
              Sign in
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (validation.status === "loading") {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <LoadingState label="Checking your invitation…" />
        </CardContent>
      </Card>
    );
  }

  if (validation.status === "invalid") {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <ErrorState
            title="This invitation link is invalid or has expired"
            description="Ask whoever invited you to send a new invitation."
          />
          <Stack alignItems="center" sx={{ mt: 1 }}>
            <Link component={RouterLink} to="/login" variant="body2" underline="hover">
              Back to sign in
            </Link>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  const { invite } = validation;
  const greetingName = invite.firstName ?? invite.email;

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5} component="form" onSubmit={onSubmit} noValidate aria-label="Set up your account">
          <Stack spacing={0.5} sx={{ mb: 0.5 }}>
            <Typography variant="h4" component="h1" textAlign="center">
              Welcome, {greetingName}
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Set a password for {invite.email} to activate your account.
            </Typography>
          </Stack>

          {formError && (
            <Alert severity="error" role="alert">
              {formError}
            </Alert>
          )}

          <TextField
            {...register("password")}
            label="Password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            fullWidth
            required
            error={!!errors.password}
            helperText={errors.password?.message ?? "Must be at least 8 characters."}
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
            label="Confirm password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            fullWidth
            required
            error={!!errors.confirmPassword}
            helperText={errors.confirmPassword?.message}
            slotProps={{ htmlInput: { "aria-required": true } }}
          />
          <Button type="submit" variant="contained" size="large" fullWidth loading={isSubmitting} disabled={isSubmitting}>
            Activate account
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
