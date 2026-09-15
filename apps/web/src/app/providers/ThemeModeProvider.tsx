import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getTheme, type ThemeMode } from "@/design-system/themes";

export type ThemePreference = ThemeMode | "system";

const STORAGE_KEY = "identity-platform.theme-preference";

interface ThemeModeContextValue {
  /** What the user picked: "light" | "dark" | "system". */
  preference: ThemePreference;
  /** What's actually rendered right now — "system" resolved to light/dark. */
  resolvedMode: ThemeMode;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function getSystemMode(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemMode, setSystemMode] = useState<ThemeMode>(getSystemMode);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemMode(event.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const resolvedMode: ThemeMode = preference === "system" ? systemMode : preference;

  const value = useMemo(
    () => ({ preference, resolvedMode, setPreference }),
    [preference, resolvedMode, setPreference],
  );

  const theme = useMemo(() => getTheme(resolvedMode), [resolvedMode]);

  return (
    <ThemeModeContext.Provider value={value}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeContextValue {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within a ThemeModeProvider");
  }
  return context;
}
