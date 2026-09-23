import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { Link as RouterLink } from "react-router-dom";

import { EmptyState } from "@/design-system/components/EmptyState";

/**
 * Lands here from the backend's `GET /oauth/authorize/resume` when the
 * pending authorization reference it was given is missing, expired,
 * already consumed, or otherwise invalid (see
 * docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md — the backend never redirects
 * this case to a client-supplied redirect_uri, since by definition there is
 * no trusted one left to redirect to at this point). There is nothing for
 * this page to resume — the original application request has to be
 * restarted from the application itself.
 */
export default function OAuthAuthorizeExpiredPage() {
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5} alignItems="center">
          <EmptyState
            variant="not-available"
            title="This sign-in request has expired"
            description="Return to the application you were signing in to and try again."
          />
          <Button component={RouterLink} to="/login" variant="contained">
            Go to sign in
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
