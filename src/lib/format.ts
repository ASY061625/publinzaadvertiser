// Money stays in integer cents right up to the moment it is rendered. The
// split below is integer division, so no float ever touches a price.
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const whole = dollars.toLocaleString("en-US");
  const body = remainder === 0 ? whole : `${whole}.${String(remainder).padStart(2, "0")}`;
  return `${negative ? "-" : ""}$${body}`;
}

export function formatTraffic(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export const BAND_LABELS = ["<40", "40–54", "55–69", "70+"] as const;

export function drBand(dr: number | null): number {
  if (dr === null) return 0;
  return dr >= 70 ? 3 : dr >= 55 ? 2 : dr >= 40 ? 1 : 0;
}

// Fixed reference so a row's traffic bar means the same thing on every page,
// rather than rescaling to whatever happens to be in the current result set.
const TRAFFIC_BAR_CEILING = 1_000_000;

export function trafficBarWidth(n: number | null): string {
  if (!n || n <= 0) return "0%";
  const pct = (Math.log10(n) / Math.log10(TRAFFIC_BAR_CEILING)) * 100;
  return `${Math.max(2, Math.min(100, pct))}%`;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function languageName(code: string): string {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}
