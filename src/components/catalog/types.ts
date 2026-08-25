export type CatalogSite = {
  id: string;
  domain: string;
  channelType: string;
  country: string;
  language: string;
  description: string | null;
  priceCents: number;
  writingCents: number;
  turnaroundDays: number;
  linkType: string;
  maxLinks: number;
  minWords: number;
  guaranteeDays: number;
  acceptsSensitive: string[];
  isExclusive: boolean;
  categories: { slug: string; name: string }[];
  metrics: {
    domainRating: number | null;
    organicTraffic: number | null;
    refDomains: number | null;
    spamScore: number | null;
    topCountry: string | null;
    topCountryShare: number | null;
    gaVerified: boolean;
    gscVerified: boolean;
    fetchedAt: string;
    /** Set by the server once the reading passes the staleness threshold. */
    stale: boolean;
  } | null;
};

export type Facets = {
  categories: { slug: string; name: string }[];
  countries: { code: string; count: number }[];
  languages: { code: string; count: number }[];
  priceMinCents: number;
  priceMaxCents: number;
};

// Mirrors the query string GET /api/sites accepts. Prices are cents.
export type FilterState = {
  q: string;
  topics: string[];
  countries: string[];
  languages: string[];
  drMin: number;
  drMax: number;
  trafficMin: number;
  priceMinCents: string;
  priceMaxCents: string;
  dofollowOnly: boolean;
  gaVerifiedOnly: boolean;
  accepts: string[];
  maxTurnaroundDays: number;
};

export const EMPTY_FILTERS: FilterState = {
  q: "",
  topics: [],
  countries: [],
  languages: [],
  drMin: 0,
  drMax: 100,
  trafficMin: 0,
  priceMinCents: "",
  priceMaxCents: "",
  dofollowOnly: false,
  gaVerifiedOnly: false,
  accepts: [],
  maxTurnaroundDays: 0,
};

export const SENSITIVE_TOPICS = ["casino", "crypto", "forex", "cbd", "adult", "dating"];

export function activeFilterCount(f: FilterState): number {
  return (
    f.topics.length +
    f.countries.length +
    f.languages.length +
    f.accepts.length +
    (f.q ? 1 : 0) +
    (f.drMin > 0 || f.drMax < 100 ? 1 : 0) +
    (f.trafficMin ? 1 : 0) +
    (f.priceMinCents !== "" || f.priceMaxCents !== "" ? 1 : 0) +
    (f.dofollowOnly ? 1 : 0) +
    (f.gaVerifiedOnly ? 1 : 0) +
    (f.maxTurnaroundDays ? 1 : 0)
  );
}

export function toQueryString(f: FilterState, sort: string, limit: number): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.topics.length) p.set("topic", f.topics.join(","));
  if (f.countries.length) p.set("country", f.countries.join(","));
  if (f.languages.length) p.set("language", f.languages.join(","));
  if (f.drMin > 0) p.set("drMin", String(f.drMin));
  if (f.drMax < 100) p.set("drMax", String(f.drMax));
  if (f.trafficMin) p.set("trafficMin", String(f.trafficMin));
  if (f.priceMinCents !== "") p.set("priceMinCents", f.priceMinCents);
  if (f.priceMaxCents !== "") p.set("priceMaxCents", f.priceMaxCents);
  if (f.dofollowOnly) p.set("dofollow", "true");
  if (f.gaVerifiedOnly) p.set("gaVerified", "true");
  if (f.accepts.length) p.set("accepts", f.accepts.join(","));
  if (f.maxTurnaroundDays) p.set("maxTurnaroundDays", String(f.maxTurnaroundDays));
  p.set("sort", sort);
  p.set("limit", String(limit));
  return p.toString();
}
