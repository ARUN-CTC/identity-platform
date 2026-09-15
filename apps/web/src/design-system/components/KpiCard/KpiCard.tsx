import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

export interface KpiCardProps {
  label: string;
  /** Omit (or pass `loading`) while the value is still resolving — renders a skeleton instead. */
  value?: ReactNode;
  loading?: boolean;
  caption?: string;
  /** When present, the whole card becomes a real, keyboard-reachable button (MUI `CardActionArea`) — never a bare `onClick` on a non-interactive element. */
  onClick?: () => void;
}

/**
 * The single "headline metric" card shape used across dashboards: an
 * uppercase label, a large value (or a loading skeleton), and an optional
 * caption underneath. Extracted from DashboardPage.tsx, which previously
 * hand-rolled six near-identical Card/CardContent blocks for this — two of
 * them clickable via a bare `onClick` on the Card itself, which is not
 * keyboard-reachable. `onClick` here always renders through
 * `CardActionArea` instead, so a clickable KpiCard is a real, focusable,
 * Enter/Space-activatable control, not just a mouse target.
 */
export function KpiCard({ label, value, loading = false, caption, onClick }: KpiCardProps) {
  const content = (
    <CardContent>
      <Typography variant="label" color="text.secondary" sx={{ textTransform: "uppercase" }}>
        {label}
      </Typography>
      {loading || value === undefined ? (
        <Skeleton variant="text" width={80} height={40} sx={{ mt: 0.5 }} />
      ) : (
        <Typography variant="h2" sx={{ mt: 0.5 }}>
          {value}
        </Typography>
      )}
      {caption && (
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      )}
    </CardContent>
  );

  if (onClick) {
    return (
      <Card sx={{ height: "100%" }}>
        <CardActionArea onClick={onClick} sx={{ height: "100%" }}>
          {content}
        </CardActionArea>
      </Card>
    );
  }

  return <Card sx={{ height: "100%" }}>{content}</Card>;
}
