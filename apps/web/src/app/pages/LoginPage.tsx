import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { useLocation, useNavigate, type Location } from "react-router-dom";

import { LoginForm } from "@/shared/auth/components/LoginForm";
import { buildAuthorizeResumeUrl } from "@/shared/auth/oauthResume";
import type { LoginResult } from "@/app/providers/AuthProvider";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Set by GET /oauth/authorize when it redirected an unauthenticated
  // browser here to sign in first — an opaque, single-use reference, never
  // raw OAuth request parameters. See
  // docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md.
  const authorizeRequest = new URLSearchParams(location.search).get("authorize_request");

  const handleSuccess = ({ organizationContext, availableOrganizations }: LoginResult) => {
    const redirectTo = (location.state as { from?: Location } | null)?.from ?? "/dashboard";
    // Brief §12: one organization -> establish it automatically (the
    // backend never auto-selects one at login; a fresh session always
    // starts tenant-wide — this is the frontend doing the obvious thing
    // when there's nothing to actually choose between). Multiple -> ask.
    if (!organizationContext && availableOrganizations.length > 1) {
      navigate("/choose-organization", { replace: true, state: { from: redirectTo, authorizeRequest } });
      return;
    }
    if (!organizationContext && availableOrganizations.length === 1) {
      navigate("/choose-organization", { replace: true, state: { from: redirectTo, autoSelect: true, authorizeRequest } });
      return;
    }
    if (authorizeRequest) {
      // A real top-level navigation, not an in-app route — the backend
      // completes the original OAuth authorization request and redirects
      // to the product's own redirect_uri from here.
      window.location.href = buildAuthorizeResumeUrl(authorizeRequest);
      return;
    }
    navigate(redirectTo, { replace: true });
  };

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        {authorizeRequest && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            You&apos;re signing in to continue to an external application.
          </Alert>
        )}
        <LoginForm title={authorizeRequest ? "Sign in to continue" : undefined} onSuccess={handleSuccess} />
      </CardContent>
    </Card>
  );
}
