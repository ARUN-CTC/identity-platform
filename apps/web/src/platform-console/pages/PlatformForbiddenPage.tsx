import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useNavigate } from "react-router-dom";

import { PermissionDeniedState } from "@/design-system/patterns/empty-state";

export default function PlatformForbiddenPage() {
  const navigate = useNavigate();
  return (
    <Stack alignItems="center" spacing={2}>
      <PermissionDeniedState />
      <Button variant="contained" onClick={() => navigate("/platform-console")}>
        Back to Platform Console
      </Button>
    </Stack>
  );
}
