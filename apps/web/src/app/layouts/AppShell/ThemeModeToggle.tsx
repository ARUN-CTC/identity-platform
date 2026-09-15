import Brightness4OutlinedIcon from "@mui/icons-material/Brightness4Outlined";
import CheckIcon from "@mui/icons-material/Check";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useState, type MouseEvent } from "react";

import { useThemeMode, type ThemePreference } from "@/app/providers/ThemeModeProvider";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof LightModeOutlinedIcon }[] = [
  { value: "light", label: "Light", icon: LightModeOutlinedIcon },
  { value: "dark", label: "Dark", icon: DarkModeOutlinedIcon },
  { value: "system", label: "System", icon: Brightness4OutlinedIcon },
];

export function ThemeModeToggle() {
  const { preference, setPreference, resolvedMode } = useThemeMode();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const CurrentIcon = resolvedMode === "dark" ? DarkModeOutlinedIcon : LightModeOutlinedIcon;

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Tooltip title="Theme">
        <IconButton onClick={handleOpen} aria-label="Change theme" size="medium">
          <CurrentIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={handleClose} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <MenuItem
            key={value}
            selected={preference === value}
            onClick={() => {
              setPreference(value);
              handleClose();
            }}
          >
            <ListItemIcon>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{label}</ListItemText>
            {preference === value && <CheckIcon fontSize="small" color="primary" />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
