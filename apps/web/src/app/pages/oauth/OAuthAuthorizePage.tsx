import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { useAuth } from "@/app/providers/AuthProvider";
import { EmptyState } from "@/design-system/components/EmptyState";
import { LoadingState } from "@/design-system/components/LoadingState";
import { LoginForm } from "@/shared/auth/components/LoginForm";
import { getOAuthErrorMessage } from "@/shared/auth/authErrorMessages";
import { getApiBaseUrl, getSessionContext } from "@/shared/api";

type Step =
  | { kind: "checking" }
  | { kind: "invalid-request" }
  | { kind: "sign-in" }
  | { kind: "authorizing" }
  | { kind: "oauth-error"; message: string }
  | { kind: "unavailable" };

/**
 * The reusable OAuth authorization shell (brief §5-8). Backs
 * `GET /oauth/authorize` for a product-initiated Authorization Code + PKCE
 * request. See docs/IDENTITY_AUTHENTICATION_UX.md §OAuth Authorization
 * Shell for the full account of why this page cannot always complete the
 * flow end-to-end — summary: the backend's real `/oauth/authorize`
 * (src/modules/oauth/controllers/authorize.controller.ts) requires an
 * `Authorization: Bearer` header (confirmed directly in JwtAuthGuard —
 * there is no cookie fallback), which a genuine top-level browser
 * navigation/redirect structurally cannot carry. This page calls the real
 * endpoint with `redirect: 'manual'` specifically so it can tell a real,
 * readable pre-redirect_uri-validation error (invalid client, unregistered
 * redirect_uri — both still direct JSON, both real and fully handled here)
 * apart from an opaque redirect (every post-validation outcome — success
 * or denial), which this platform's current session architecture cannot
 * complete via any real browser-visible navigation. That second case is
 * reported honestly as unavailable, never faked as a working redirect.
 */
export default function OAuthAuthorizePage() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const [step, setStep] = useState<Step>({ kind: "checking" });

  const params = new URLSearchParams(location.search);
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");

  useEffect(() => {
    if (isLoading) return;

    // Mirrors the backend's own validation order exactly (brief §26/the
    // backend's own doc comment): client_id/redirect_uri missing at all is
    // never even worth a round trip — the real endpoint would reject this
    // as a direct 400 too, never a redirect.
    if (!clientId || !redirectUri) {
      setStep({ kind: "invalid-request" });
      return;
    }

    if (!isAuthenticated) {
      setStep({ kind: "sign-in" });
      return;
    }

    setStep({ kind: "authorizing" });
    const { accessToken } = getSessionContext();
    if (!accessToken) {
      // isAuthenticated just flipped true but the token hasn't landed in
      // the session store yet (a brief cross-render window) — retry once
      // isLoading/isAuthenticated settle again via the effect's own deps.
      return;
    }

    const controller = new AbortController();
    fetch(`${getApiBaseUrl()}/oauth/authorize${location.search}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "manual",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.type === "opaqueredirect") {
          // A real HTTP redirect happened — client_id and redirect_uri are
          // both valid and trusted, and the backend either issued a code or
          // denied the request with an error, encoded into the redirect
          // target. Either way, only a genuine top-level browser navigation
          // can land the user there, and no such navigation to this
          // endpoint can carry the Bearer credential it requires (see this
          // file's own header comment). Documented gap, not simulated.
          setStep({ kind: "unavailable" });
          return;
        }
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setStep({ kind: "oauth-error", message: getOAuthErrorMessage(body?.error ?? "invalid_request") });
      })
      .catch(() => {
        setStep({ kind: "oauth-error", message: "Unable to connect. Check your connection and try again." });
      });

    return () => controller.abort();
  }, [isAuthenticated, isLoading, clientId, redirectUri, location.search]);

  if (step.kind === "checking" || step.kind === "authorizing" || isLoading) {
    return <LoadingState label="Checking sign-in request…" />;
  }

  if (step.kind === "invalid-request") {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <EmptyState
            variant="not-available"
            title="Unable to process sign-in request"
            description="This sign-in link is missing required information. Contact the application you were trying to reach."
          />
        </CardContent>
      </Card>
    );
  }

  if (step.kind === "oauth-error") {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <EmptyState variant="not-available" title="Unable to sign in" description={step.message} />
        </CardContent>
      </Card>
    );
  }

  if (step.kind === "unavailable") {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <EmptyState
            variant="not-available"
            title="Unable to complete sign-in for this application"
            description="This platform can't finish signing you in here yet. Contact the application or your platform administrator."
          />
        </CardContent>
      </Card>
    );
  }

  // step.kind === "sign-in" — never shows which application asked (brief
  // §8: only a validated Application record may drive branding, and no
  // endpoint exists yet for this platform to safely resolve one before
  // authenticating — see docs/IDENTITY_AUTHENTICATION_UX.md's API gap
  // table). The generic notice below at least orients the user without
  // fabricating trust in an unvalidated client_id.
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Alert severity="info" sx={{ mb: 2.5 }}>
          You're signing in to continue to an external application.
        </Alert>
        {/* No-op on purpose: isAuthenticated flipping true (which happens
            mid-way through login(), before this callback even fires — see
            AuthProvider.establishSession) already re-triggers this page's
            own effect independently. Setting step here too raced that
            effect: onSuccess can fire AFTER the effect has already moved
            past "authorizing" (e.g. to "unavailable"), silently reverting
            it back — a real bug caught by this page's own tests. */}
        <LoginForm title="Sign in to continue" onSuccess={() => {}} />
      </CardContent>
    </Card>
  );
}
