import { prisma } from "@/lib/db";

/**
 * Metrics refresh.
 *
 * Two rules dominate this file:
 *   1. A failed lookup must never hide a site or zero its metrics. A site whose
 *      call errored has stale data, not no traffic.
 *   2. Lookups cost money per domain, so the cadence is tiered and the daily
 *      spend is capped — and hitting the cap alerts rather than stopping quietly.
 */

export const STALENESS_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export type SiteMetricValues = {
  domainRating?: number | null;
  urlRating?: number | null;
  organicTraffic?: number | null;
  refDomains?: number | null;
  spamScore?: number | null;
  topCountry?: string | null;
  topCountryShare?: number | null;
};

export interface MetricsProvider {
  fetchMetrics(domain: string): Promise<SiteMetricValues>;
}

/**
 * DataForSEO adapter. REST over fetch, so no SDK and no install script.
 * Without credentials the refresh is a no-op that reports failure rather than
 * throwing, so a missing key degrades to stale data instead of an outage.
 */
export const DataForSeoProvider: MetricsProvider & { isConfigured: () => boolean } = {
  isConfigured: () => !!process.env.DATAFORSEO_LOGIN && !!process.env.DATAFORSEO_PASSWORD,

  async fetchMetrics(domain: string): Promise<SiteMetricValues> {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) throw new Error("DataForSEO credentials are not configured.");

    const res = await fetch(
      "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live",
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify([{ target: domain, location_code: 2840, language_code: "en" }]),
      }
    );

    if (!res.ok) throw new Error(`DataForSEO returned ${res.status}`);

    const json = (await res.json()) as Record<string, unknown>;
    const item = (json.tasks as { result?: { items?: Record<string, unknown>[] }[] }[])?.[0]
      ?.result?.[0]?.items?.[0];
    if (!item) throw new Error("DataForSEO returned no result for this domain.");

    const organic = (item.metrics as { organic?: Record<string, number> } | undefined)?.organic;

    return {
      domainRating: typeof item.rank === "number" ? item.rank : null,
      organicTraffic: organic?.etv != null ? Math.round(organic.etv) : null,
      refDomains: typeof item.referring_domains === "number" ? item.referring_domains : null,
      spamScore: typeof item.spam_score === "number" ? item.spam_score : null,
    };
  },
};

/** Test seam: swaps the provider without touching the registry. */
let fakeProvider: MetricsProvider | null = null;

export function setFakeMetricsProvider(provider: MetricsProvider | null) {
  fakeProvider = provider;
}

function provider(): MetricsProvider {
  return fakeProvider ?? DataForSeoProvider;
}

/** Metrics this old carry a staleness indicator in the UI. */
export function isStale(fetchedAt: Date | string | null | undefined): boolean {
  if (!fetchedAt) return true;
  const at = typeof fetchedAt === "string" ? new Date(fetchedAt) : fetchedAt;
  return Date.now() - at.getTime() > STALENESS_DAYS * DAY;
}

export type RefreshResult = { siteId: string; succeeded: boolean; error?: string };

/**
 * Refreshes one site.
 *
 * On failure nothing is written to SiteMetric at all — not the values, not
 * fetchedAt. The previous reading stays exactly as it was, and the failure is
 * recorded separately.
 */
export async function refreshSiteMetrics(siteId: string): Promise<RefreshResult> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, domain: true },
  });
  if (!site) return { siteId, succeeded: false, error: "unknown site" };

  try {
    const values = await provider().fetchMetrics(site.domain);

    await prisma.siteMetric.upsert({
      where: { siteId: site.id },
      create: { siteId: site.id, ...values, fetchedAt: new Date() },
      update: { ...values, fetchedAt: new Date() },
    });

    await prisma.metricsRefreshLog.create({
      data: { siteId: site.id, succeeded: true },
    });
    return { siteId, succeeded: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Deliberately no write to SiteMetric here. Zeroing values or bumping
    // fetchedAt on a failure would turn a transient API error into a site that
    // looks dead, or into stale data pretending to be fresh.
    await prisma.metricsRefreshLog.create({
      data: { siteId: site.id, succeeded: false, error: message.slice(0, 500) },
    });

    console.error("Metrics refresh failed", { siteId, domain: site.domain, message });
    return { siteId, succeeded: false, error: message };
  }
}

/* ───────────────────────────  cadence  ─────────────────────────── */

export type Tier = "weekly" | "monthly" | "on-demand";

/**
 * Refresh cadence, from PHASE6.md:
 *   ordered or viewed in the last 30 days → weekly
 *   active, not recently viewed          → monthly
 *   inactive                             → on demand only
 */
export function tierFor(site: {
  isActive: boolean;
  lastViewedAt: Date | null;
  hasRecentOrder?: boolean;
}): Tier {
  if (!site.isActive) return "on-demand";

  const recentlyViewed =
    !!site.lastViewedAt && Date.now() - site.lastViewedAt.getTime() < 30 * DAY;

  return recentlyViewed || site.hasRecentOrder ? "weekly" : "monthly";
}

/** Sites whose last refresh is older than their tier allows. */
export async function dueSiteIds(limit = 500): Promise<string[]> {
  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: {
      id: true,
      isActive: true,
      lastViewedAt: true,
      metrics: { select: { fetchedAt: true } },
      orderItems: {
        where: { order: { createdAt: { gte: new Date(Date.now() - 30 * DAY) } } },
        select: { id: true },
        take: 1,
      },
    },
    take: 5_000,
  });

  const due = sites.filter((site) => {
    const tier = tierFor({
      isActive: site.isActive,
      lastViewedAt: site.lastViewedAt,
      hasRecentOrder: site.orderItems.length > 0,
    });
    if (tier === "on-demand") return false;

    const fetchedAt = site.metrics?.fetchedAt;
    if (!fetchedAt) return true;

    const age = Date.now() - fetchedAt.getTime();
    return tier === "weekly" ? age > 7 * DAY : age > 30 * DAY;
  });

  return due.slice(0, limit).map((s) => s.id);
}

/* ─────────────────────────  spend cap  ───────────────────────── */

export const DEFAULT_DAILY_CAP_MINOR = Number(process.env.METRICS_DAILY_CAP_MINOR ?? 5_000);
export const DEFAULT_COST_PER_LOOKUP_MINOR = Number(process.env.METRICS_COST_PER_LOOKUP_MINOR ?? 10);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function resetMetricsSpend(day = today()) {
  await prisma.metricsSpend.deleteMany({ where: { day } });
}

export async function spendToday(day = today()) {
  return prisma.metricsSpend.findUnique({ where: { day } });
}

export type BatchOutcome = {
  refreshed: number;
  failed: number;
  skippedForCap: number;
  capHit: boolean;
  spentMinor: number;
};

/**
 * Refreshes a batch, stopping at the daily spend cap.
 *
 * Hitting the cap records `capHitAt` and `alertedAt` — the point is that a
 * silently truncated refresh looks identical to a healthy one, and the catalog
 * quietly rots.
 */
export async function refreshDueSites(options: {
  siteIds?: string[];
  capMinor?: number;
  costPerLookupMinor?: number;
  limit?: number;
} = {}): Promise<BatchOutcome> {
  const capMinor = options.capMinor ?? DEFAULT_DAILY_CAP_MINOR;
  const costPerLookupMinor = options.costPerLookupMinor ?? DEFAULT_COST_PER_LOOKUP_MINOR;
  const siteIds = options.siteIds ?? (await dueSiteIds(options.limit));

  const day = today();
  const spend = await prisma.metricsSpend.upsert({
    where: { day },
    create: { day, capMinor },
    update: { capMinor },
  });

  let spentMinor = spend.spentMinor;
  const outcome: BatchOutcome = {
    refreshed: 0,
    failed: 0,
    skippedForCap: 0,
    capHit: false,
    spentMinor,
  };

  for (const siteId of siteIds) {
    if (spentMinor + costPerLookupMinor > capMinor) {
      outcome.skippedForCap += 1;
      outcome.capHit = true;
      continue;
    }

    const result = await refreshSiteMetrics(siteId);
    // A failed lookup still costs money — the provider was called.
    spentMinor += costPerLookupMinor;
    if (result.succeeded) outcome.refreshed += 1;
    else outcome.failed += 1;
  }

  outcome.spentMinor = spentMinor;

  await prisma.metricsSpend.update({
    where: { day },
    data: {
      spentMinor,
      lookups: { increment: outcome.refreshed + outcome.failed },
      ...(outcome.capHit
        ? {
            capHitAt: spend.capHitAt ?? new Date(),
            // Alerting is the whole point of the cap; stopping silently is the
            // failure mode this guards against.
            alertedAt: spend.alertedAt ?? new Date(),
          }
        : {}),
    },
  });

  if (outcome.capHit) {
    console.warn(
      `Metrics daily spend cap reached: ${spentMinor}/${capMinor} minor units. ` +
        `${outcome.skippedForCap} site(s) not refreshed.`
    );
  }

  return outcome;
}
