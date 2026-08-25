export const SORTS = ["dr", "traffic", "price_asc", "price_desc", "turnaround"] as const;
export type Sort = (typeof SORTS)[number];

export const SENSITIVE_TOPICS = ["casino", "crypto", "forex", "cbd", "adult", "dating"] as const;

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 50;

export type CatalogFilters = {
  q: string | null;
  topics: string[];
  countries: string[];
  languages: string[];
  drMin: number | null;
  drMax: number | null;
  trafficMin: number | null;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  dofollowOnly: boolean;
  gaVerifiedOnly: boolean;
  maxTurnaroundDays: number | null;
  accepts: string[];
  sort: Sort;
  limit: number;
  cursor: string | null;
};

export class FilterError extends Error {}

function list(params: URLSearchParams, key: string): string[] {
  // Accepts both `?country=US&country=GB` and `?country=US,GB`.
  const raw = params.getAll(key).flatMap((v) => v.split(","));
  return [...new Set(raw.map((v) => v.trim()).filter(Boolean))];
}

function int(params: URLSearchParams, key: string, min: number, max: number): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new FilterError(`${key} must be an integer`);
  if (n < min || n > max) throw new FilterError(`${key} must be between ${min} and ${max}`);
  return n;
}

function bool(params: URLSearchParams, key: string): boolean {
  const raw = params.get(key);
  return raw === "true" || raw === "1";
}

export function parseFilters(params: URLSearchParams): CatalogFilters {
  const q = params.get("q")?.trim() || null;
  if (q && q.length > 120) throw new FilterError("q is too long");

  const drMin = int(params, "drMin", 0, 100);
  const drMax = int(params, "drMax", 0, 100);
  if (drMin !== null && drMax !== null && drMin > drMax) {
    throw new FilterError("drMin cannot exceed drMax");
  }

  const priceMinCents = int(params, "priceMinCents", 0, 100_000_00);
  const priceMaxCents = int(params, "priceMaxCents", 0, 100_000_00);
  if (priceMinCents !== null && priceMaxCents !== null && priceMinCents > priceMaxCents) {
    throw new FilterError("priceMinCents cannot exceed priceMaxCents");
  }

  const accepts = list(params, "accepts");
  for (const a of accepts) {
    if (!(SENSITIVE_TOPICS as readonly string[]).includes(a)) {
      throw new FilterError(`unknown restricted topic: ${a}`);
    }
  }

  const sortRaw = params.get("sort") ?? "dr";
  if (!(SORTS as readonly string[]).includes(sortRaw)) {
    throw new FilterError(`sort must be one of: ${SORTS.join(", ")}`);
  }

  const limit = int(params, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

  return {
    q,
    topics: list(params, "topic"),
    countries: list(params, "country").map((c) => c.toUpperCase()),
    languages: list(params, "language").map((l) => l.toLowerCase()),
    drMin,
    drMax,
    trafficMin: int(params, "trafficMin", 0, 1_000_000_000),
    priceMinCents,
    priceMaxCents,
    dofollowOnly: bool(params, "dofollow"),
    gaVerifiedOnly: bool(params, "gaVerified"),
    maxTurnaroundDays: int(params, "maxTurnaroundDays", 1, 365),
    accepts,
    sort: sortRaw as Sort,
    limit,
    cursor: params.get("cursor"),
  };
}
