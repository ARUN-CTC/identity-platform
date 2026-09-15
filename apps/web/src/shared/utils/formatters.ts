const DEFAULT_LOCALE = "en-US";

export function formatDate(value: string | number | Date, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value: string | number | Date, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function formatCurrency(
  value: number,
  currencyCode = "USD",
  locale = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(value);
}

export function formatNumber(value: number, locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** File size for Document Management's own upload UX (drop-zone hint, selected-file chip). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

type RelativeUnit = "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

const RELATIVE_STEPS: [thresholdSeconds: number, unit: RelativeUnit, divisor: number][] = [
  [60, "second", 1],
  [3600, "minute", 60],
  [86400, "hour", 3600],
  [604800, "day", 86400],
  [2629800, "week", 604800],
  [31557600, "month", 2629800],
  [Infinity, "year", 31557600],
];

export function formatRelativeTime(value: string | number | Date, locale = DEFAULT_LOCALE): string {
  const diffSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const [, unit, divisor] =
    RELATIVE_STEPS.find(([limit]) => Math.abs(diffSeconds) < limit) ??
    RELATIVE_STEPS[RELATIVE_STEPS.length - 1];

  return rtf.format(Math.round(diffSeconds / divisor), unit);
}
