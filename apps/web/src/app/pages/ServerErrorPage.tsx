import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";

import { ErrorState } from "@/design-system/components/ErrorState";

export default function ServerErrorPage() {
  return (
    <Stack alignItems="center" spacing={2}>
      <ErrorState title="Something went wrong on our end" description="Our team has been notified. Please try again in a moment." />
      <Button variant="contained" onClick={() => window.location.reload()}>
        Reload page
      </Button>
    </Stack>
  );
}
