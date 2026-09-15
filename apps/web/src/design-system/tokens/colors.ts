/**
 * TravelOS color primitives.
 *
 * These are raw scales, not semantic assignments — themes/light.ts and
 * themes/dark.ts map them onto MUI's palette. Never import these directly
 * into a component; consume `theme.palette.*` instead so tenant branding
 * and dark mode stay consistent.
 */

export const neutral = {
  0: "#FFFFFF",
  50: "#F7F8FA",
  100: "#EEF0F3",
  200: "#E2E5EA",
  300: "#CDD2DA",
  400: "#A6ADB8",
  500: "#7C8493",
  600: "#5B6472",
  700: "#414957",
  800: "#2A3040",
  900: "#181C27",
  950: "#0D0F16",
  1000: "#000000",
} as const;

export const brand = {
  50: "#EEF2FF",
  100: "#E0E7FF",
  200: "#C7D2FE",
  300: "#A5B4FC",
  400: "#818CF8",
  500: "#6366F1",
  600: "#4F46E5",
  700: "#4338CA",
  800: "#3730A3",
  900: "#312E81",
} as const;

export const teal = {
  50: "#ECFEFF",
  100: "#CFFAFE",
  200: "#A5F3FC",
  300: "#67E8F9",
  400: "#22D3EE",
  500: "#06B6D4",
  600: "#0891B2",
  700: "#0E7490",
  800: "#155E75",
  900: "#164E63",
} as const;

export const green = {
  50: "#ECFDF3",
  100: "#D1FADF",
  200: "#A6F4C5",
  300: "#6CE9A6",
  400: "#32D583",
  500: "#12B76A",
  600: "#039855",
  700: "#027A48",
  800: "#05603A",
  900: "#054F31",
} as const;

export const amber = {
  50: "#FFFAEB",
  100: "#FEF0C7",
  200: "#FEDF89",
  300: "#FEC84B",
  400: "#FDB022",
  500: "#F79009",
  600: "#DC6803",
  700: "#B54708",
  800: "#93370D",
  900: "#7A2E0E",
} as const;

export const red = {
  50: "#FEF3F2",
  100: "#FEE4E2",
  200: "#FECDCA",
  300: "#FDA29B",
  400: "#F97066",
  500: "#F04438",
  600: "#D92D20",
  700: "#B42318",
  800: "#912018",
  900: "#7A271A",
} as const;

export const blue = {
  50: "#EFF8FF",
  100: "#D1E9FF",
  200: "#B2DDFF",
  300: "#84CAFF",
  400: "#53B1FD",
  500: "#2E90FA",
  600: "#1570EF",
  700: "#175CD3",
  800: "#1849A9",
  900: "#194185",
} as const;

export const violet = {
  50: "#F5F3FF",
  100: "#EDE9FE",
  200: "#DDD6FE",
  300: "#C4B5FD",
  400: "#A78BFA",
  500: "#8B5CF6",
  600: "#7C3AED",
  700: "#6D28D9",
  800: "#5B21B6",
  900: "#4C1D95",
} as const;

export const slateBlue = {
  50: "#F4F6FB",
  100: "#E7EBF5",
  200: "#CBD3E6",
} as const;

export const colorTokens = {
  neutral,
  brand,
  teal,
  green,
  amber,
  red,
  blue,
  violet,
  slateBlue,
} as const;
