import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { useLocation, useNavigate, type Location } from "react-router-dom";

import { LoginForm } from "@/shared/auth/components/LoginForm";
import type { LoginResult } from "@/app/providers/AuthProvider";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleSuccess = ({ organizationContext, availableOrganizations }: LoginResult) => {
    const redirectTo = (location.state as { from?: Location } | null)?.from ?? "/dashboard";
    // Brief §12: one organization -> establish it automatically (the
    // backend never auto-selects one at login; a fresh session always
    // starts tenant-wide — this is the frontend doing the obvious thing
    // when there's nothing to actually choose between). Multiple -> ask.
    if (!organizationContext && availableOrganizations.length > 1) {
      navigate("/choose-organization", { replace: true, state: { from: redirectTo } });
    } else if (!organizationContext && availableOrganizations.length === 1) {
      navigate("/choose-organization", { replace: true, state: { from: redirectTo, autoSelect: true } });
    } else {
      navigate(redirectTo, { replace: true });
    }
  };

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <LoginForm onSuccess={handleSuccess} />
      </CardContent>
    </Card>
  );
}
