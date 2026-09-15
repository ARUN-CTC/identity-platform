import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Outlet } from "react-router-dom";

/** Centered, chromeless layout for /login and standalone status pages (403/404/500). */
export function AuthLayout() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        px: 2,
      }}
    >
      <Stack spacing={4} alignItems="center" sx={{ width: "100%", maxWidth: 420 }}>
        <Typography variant="h3" component="span" sx={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
          Identity Platform
        </Typography>
        <Box sx={{ width: "100%" }}>
          <Outlet />
        </Box>
      </Stack>
    </Box>
  );
}
