/**
 * Maps TravelOS's five named breakpoints onto MUI's xs/sm/md/lg/xl keys
 * so we can keep using `theme.breakpoints.up("md")` etc. throughout,
 * while still having human names to refer to in docs/specs.
 */
export const breakpoints = {
  mobile: 0,
  tablet: 600,
  laptop: 900,
  desktop: 1200,
  largeDesktop: 1536,
} as const;

export const muiBreakpointValues = {
  xs: breakpoints.mobile,
  sm: breakpoints.tablet,
  md: breakpoints.laptop,
  lg: breakpoints.desktop,
  xl: breakpoints.largeDesktop,
} as const;

export const breakpointTokens = { breakpoints, muiBreakpointValues } as const;
