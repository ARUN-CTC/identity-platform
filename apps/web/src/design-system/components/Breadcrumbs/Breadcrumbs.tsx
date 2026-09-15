import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import MuiBreadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

/** Generic, route-agnostic breadcrumb trail — see app/router for the hook that derives `items` from the current route. */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  if (items.length < 2) return null;

  return (
    <MuiBreadcrumbs
      aria-label="Breadcrumb"
      separator={<NavigateNextIcon sx={{ fontSize: 14 }} />}
      sx={{ fontSize: "0.8125rem", mb: 2 }}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        if (isLast || !item.path) {
          return (
            <Typography key={item.label} variant="body2" color="text.secondary" component="span">
              {item.label}
            </Typography>
          );
        }
        return (
          <Link key={item.label} component={RouterLink} to={item.path} underline="hover" color="text.secondary" variant="body2">
            {item.label}
          </Link>
        );
      })}
    </MuiBreadcrumbs>
  );
}
