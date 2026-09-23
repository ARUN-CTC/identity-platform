import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Radio from "@mui/material/Radio";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";

import { useAuth } from "@/app/providers/AuthProvider";
import { LoadingState } from "@/design-system/components/LoadingState";
import { getAuthErrorMessage } from "@/shared/auth/authErrorMessages";

interface NavState {
  from?: Location | string;
  /** Set by LoginPage when exactly one organization is available — nothing to actually choose, so this page establishes it and moves on without waiting for a click. */
  autoSelect?: boolean;
}

/**
 * Brief §12 — shown after login when the caller's context is still
 * tenant-wide (the backend never auto-selects an organization at login;
 * see AuthProvider's own doc comment) and they hold an ACTIVE membership in
 * one or more organizations. The server remains authoritative throughout:
 * this page only ever sends the id the caller picked from their own real
 * `availableOrganizations` list — switchOrganization()'s backend call
 * independently re-validates it before anything changes (see
 * AuthProvider.switchOrganization's own doc comment).
 */
export default function ChooseOrganizationPage() {
  const { availableOrganizations, switchOrganization } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as NavState | null) ?? {};
  const redirectTo = navState.from ?? "/dashboard";

  const [selected, setSelected] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proceed = async (organizationId?: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await switchOrganization(organizationId);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (navState.autoSelect && availableOrganizations.length === 1) {
      void proceed(availableOrganizations[0].organizationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount for the auto-select case only
  }, []);

  if (navState.autoSelect) {
    return <LoadingState label="Setting up your workspace…" />;
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5}>
          <Stack spacing={0.5}>
            <Typography variant="h4" component="h1" textAlign="center">
              Choose an organization
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              You belong to more than one organization. Pick one to continue, or stay tenant-wide.
            </Typography>
          </Stack>

          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}

          <List sx={{ bgcolor: "background.paper" }} aria-label="Organizations">
            {availableOrganizations.map((org) => (
              <ListItemButton
                key={org.organizationId}
                selected={selected === org.organizationId}
                onClick={() => setSelected(org.organizationId)}
                disabled={submitting}
              >
                <ListItemIcon>
                  <Radio checked={selected === org.organizationId} disabled={submitting} tabIndex={-1} />
                </ListItemIcon>
                <ListItemIcon>
                  <ApartmentOutlinedIcon />
                </ListItemIcon>
                <ListItemText primary={org.organizationName} secondary={org.tenantName} />
              </ListItemButton>
            ))}
          </List>

          <Stack spacing={1}>
            <Button variant="contained" size="large" fullWidth loading={submitting} disabled={submitting || !selected} onClick={() => proceed(selected)}>
              Continue
            </Button>
            <Button variant="text" size="small" fullWidth disabled={submitting} onClick={() => proceed(undefined)}>
              Continue tenant-wide instead
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
