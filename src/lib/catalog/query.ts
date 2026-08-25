import { assertApproved } from "@/lib/data/access";
import type { Actor } from "@/lib/data/actor";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FilterError, type CatalogFilters, type Sort } from "./filters";
import { isStale } from "@/lib/monitoring/metrics";

// The advertiser-facing shape. `costCents`, `publisherId` and everything on
// Publisher are deliberately absent — see rule 1 and rule 5 in CLAUDE.md.
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
    fetchedAt: Date;
    /**
     * True once the reading passes the staleness threshold. Computed here so
     * the UI shows one consistent answer rather than each surface inventing its
     * own cutoff — an advertiser making a $500 call deserves to know the DR
     * they are looking at is two months old.
     */
    stale: boolean;
  } | null;
};

type SortSpec = {
  // The scalar the cursor carries. Coalesced so NULL metrics sort predictably
  // instead of dropping out of a keyset comparison.
  key: Prisma.Sql;
  direction: "ASC" | "DESC";
};

const SORT_SPECS: Record<Sort, SortSpec> = {
  dr: { key: Prisma.sql`COALESCE(m."domainRating", -1)`, direction: "DESC" },
  traffic: { key: Prisma.sql`COALESCE(m."organicTraffic", -1)`, direction: "DESC" },
  price_asc: { key: Prisma.sql`s."priceCents"`, direction: "ASC" },
  price_desc: { key: Prisma.sql`s."priceCents"`, direction: "DESC" },
  turnaround: { key: Prisma.sql`s."turnaroundDays"`, direction: "ASC" },
};

export function encodeCursor(sort: Sort, value: number, id: string): string {
  return Buffer.from(`${sort}|${value}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string, sort: Sort): { value: number; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new FilterError("malformed cursor");
  }
  const [cursorSort, rawValue, id] = decoded.split("|");
  if (!cursorSort || rawValue === undefined || !id) throw new FilterError("malformed cursor");
  if (cursorSort !== sort) throw new FilterError("cursor does not match the requested sort");
  const value = Number(rawValue);
  if (!Number.isFinite(value)) throw new FilterError("malformed cursor");
  return { value, id };
}

function buildWhere(f: CatalogFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`s."isActive" = true`];

  if (f.q) parts.push(Prisma.sql`s.domain ILIKE ${`%${f.q}%`}`);
  if (f.countries.length) parts.push(Prisma.sql`s.country = ANY(${f.countries})`);
  if (f.languages.length) parts.push(Prisma.sql`s.language = ANY(${f.languages})`);
  if (f.priceMinCents !== null) parts.push(Prisma.sql`s."priceCents" >= ${f.priceMinCents}`);
  if (f.priceMaxCents !== null) parts.push(Prisma.sql`s."priceCents" <= ${f.priceMaxCents}`);
  if (f.dofollowOnly) parts.push(Prisma.sql`s."linkType" IN ('DOFOLLOW', 'MIXED')`);
  if (f.maxTurnaroundDays !== null) {
    parts.push(Prisma.sql`s."turnaroundDays" <= ${f.maxTurnaroundDays}`);
  }
  // Site must accept every restricted topic asked for, not just one of them.
  if (f.accepts.length) parts.push(Prisma.sql`s."acceptsSensitive" @> ${f.accepts}`);

  if (f.drMin !== null) parts.push(Prisma.sql`m."domainRating" >= ${f.drMin}`);
  if (f.drMax !== null) parts.push(Prisma.sql`m."domainRating" <= ${f.drMax}`);
  if (f.trafficMin !== null) parts.push(Prisma.sql`m."organicTraffic" >= ${f.trafficMin}`);
  if (f.gaVerifiedOnly) parts.push(Prisma.sql`m."gaVerified" = true`);

  if (f.topics.length) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "CategoryOnSite" cs
      JOIN "Category" c ON c.id = cs."categoryId"
      WHERE cs."siteId" = s.id AND c.slug = ANY(${f.topics})
    )`);
  }

  return Prisma.join(parts, " AND ");
}

type SiteRow = Omit<CatalogSite, "categories" | "metrics"> & {
  sortValue: number;
  domainRating: number | null;
  organicTraffic: number | null;
  refDomains: number | null;
  spamScore: number | null;
  topCountry: string | null;
  topCountryShare: number | null;
  gaVerified: boolean | null;
  gscVerified: boolean | null;
  fetchedAt: Date | null;
};

/**
 * Every catalog read takes the actor it is for and refuses anyone not approved.
 *
 * The gate is here, at the query, rather than in the routes above it. A new
 * catalog endpoint written next month cannot forget to call it, because there
 * is no way to get rows without passing an approved actor.
 */
export async function queryCatalog(actor: Actor | null | undefined, f: CatalogFilters) {
  assertApproved(actor);
  const spec = SORT_SPECS[f.sort];
  const where = buildWhere(f);

  // Keyset: compare the (sortKey, id) tuple against the cursor's. Both columns
  // move in the same direction so a single row comparison is enough.
  let keyset: Prisma.Sql = Prisma.empty;
  if (f.cursor) {
    const { value, id } = decodeCursor(f.cursor, f.sort);
    const op = spec.direction === "DESC" ? Prisma.sql`<` : Prisma.sql`>`;
    keyset = Prisma.sql` AND (${spec.key}, s.id) ${op} (${value}, ${id})`;
  }

  const dir = spec.direction === "DESC" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

  const rows = await prisma.$queryRaw<SiteRow[]>`
    SELECT
      s.id,
      s.domain,
      s."channelType"::text AS "channelType",
      s.country,
      s.language,
      s.description,
      s."priceCents",
      s."writingCents",
      s."turnaroundDays",
      s."linkType"::text AS "linkType",
      s."maxLinks",
      s."minWords",
      s."guaranteeDays",
      s."acceptsSensitive",
      s."isExclusive",
      ${spec.key} AS "sortValue",
      m."domainRating",
      m."organicTraffic",
      m."refDomains",
      m."spamScore",
      m."topCountry",
      m."topCountryShare",
      m."gaVerified",
      m."gscVerified",
      m."fetchedAt"
    FROM "Site" s
    LEFT JOIN "SiteMetric" m ON m."siteId" = s.id
    WHERE ${where}${keyset}
    ORDER BY ${spec.key} ${dir}, s.id ${dir}
    LIMIT ${f.limit + 1}
  `;

  const hasMore = rows.length > f.limit;
  const page = hasMore ? rows.slice(0, f.limit) : rows;

  const categoriesBySite = await loadCategories(page.map((r) => r.id));

  const sites: CatalogSite[] = page.map((r) => ({
    id: r.id,
    domain: r.domain,
    channelType: r.channelType,
    country: r.country,
    language: r.language,
    description: r.description,
    priceCents: r.priceCents,
    writingCents: r.writingCents,
    turnaroundDays: r.turnaroundDays,
    linkType: r.linkType,
    maxLinks: r.maxLinks,
    minWords: r.minWords,
    guaranteeDays: r.guaranteeDays,
    acceptsSensitive: r.acceptsSensitive,
    isExclusive: r.isExclusive,
    categories: categoriesBySite.get(r.id) ?? [],
    metrics: r.fetchedAt
      ? {
          domainRating: r.domainRating,
          organicTraffic: r.organicTraffic,
          refDomains: r.refDomains,
          spamScore: r.spamScore,
          topCountry: r.topCountry,
          topCountryShare: r.topCountryShare,
          stale: isStale(r.fetchedAt),
          gaVerified: r.gaVerified ?? false,
          gscVerified: r.gscVerified ?? false,
          fetchedAt: r.fetchedAt,
        }
      : null,
  }));

  const last = page.at(-1);
  return {
    sites,
    nextCursor: hasMore && last ? encodeCursor(f.sort, Number(last.sortValue), last.id) : null,
  };
}

export async function countCatalog(
  actor: Actor | null | undefined,
  f: CatalogFilters
): Promise<number> {
  assertApproved(actor);
  const where = buildWhere(f);
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM "Site" s
    LEFT JOIN "SiteMetric" m ON m."siteId" = s.id
    WHERE ${where}
  `;
  return Number(rows[0]?.n ?? 0);
}

async function loadCategories(siteIds: string[]) {
  const map = new Map<string, { slug: string; name: string }[]>();
  if (siteIds.length === 0) return map;

  const rows = await prisma.$queryRaw<{ siteId: string; slug: string; name: string }[]>`
    SELECT cs."siteId", c.slug, c.name
    FROM "CategoryOnSite" cs
    JOIN "Category" c ON c.id = cs."categoryId"
    WHERE cs."siteId" = ANY(${siteIds})
    ORDER BY c.name
  `;
  for (const r of rows) {
    const existing = map.get(r.siteId);
    if (existing) existing.push({ slug: r.slug, name: r.name });
    else map.set(r.siteId, [{ slug: r.slug, name: r.name }]);
  }
  return map;
}
