import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useNavigate } from "react-router-dom";

import { NotFoundState } from "@/design-system/patterns/empty-state";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Stack alignItems="center" spacing={2}>
      <NotFoundState />
      <Button variant="contained" onClick={() => navigate("/dashboard")}>
        Back to dashboard
      </Button>
    </Stack>
  );
}
