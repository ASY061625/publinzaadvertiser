import { CatalogShell } from "@/components/catalog/CatalogShell";
import { TopBar } from "@/components/TopBar";
import type { Facets } from "@/components/catalog/types";
import { prisma } from "@/lib/db";
import { requireApprovedPage } from "@/lib/data/session";
import { resolveCurrentProject } from "@/lib/data/current-project";

export const dynamic = "force-dynamic";

// Server component: renders the chrome and hands the client the facet lists it
// needs to draw the filter rail. Filtering itself always happens in SQL.
async function loadFacets(): Promise<Facets> {
  const [categories, countries, languages, bounds] = await Promise.all([
    prisma.$queryRaw<{ slug: string; name: string }[]>`
      SELECT DISTINCT c.slug, c.name
      FROM "Category" c
      JOIN "CategoryOnSite" cs ON cs."categoryId" = c.id
      JOIN "Site" s ON s.id = cs."siteId" AND s."isActive" = true
      ORDER BY c.name
    `,
    prisma.$queryRaw<{ code: string; count: bigint }[]>`
      SELECT country AS code, COUNT(*)::bigint AS count
      FROM "Site" WHERE "isActive" = true GROUP BY country ORDER BY country
    `,
    prisma.$queryRaw<{ code: string; count: bigint }[]>`
      SELECT language AS code, COUNT(*)::bigint AS count
      FROM "Site" WHERE "isActive" = true GROUP BY language ORDER BY language
    `,
    prisma.$queryRaw<{ minPrice: number | null; maxPrice: number | null }[]>`
      SELECT MIN("priceCents")::int AS "minPrice", MAX("priceCents")::int AS "maxPrice"
      FROM "Site" WHERE "isActive" = true
    `,
  ]);

  return {
    categories,
    countries: countries.map((c) => ({ code: c.code, count: Number(c.count) })),
    languages: languages.map((l) => ({ code: l.code, count: Number(l.count) })),
    priceMinCents: bounds[0]?.minPrice ?? 0,
    priceMaxCents: bounds[0]?.maxPrice ?? 0,
  };
}

export default async function CatalogPage() {
  // The catalog is the gated surface. Signed-out visitors go to login, and
  // anyone not APPROVED goes to the holding page — before any facet query runs,
  // so not even a count of countries is computed for them.
  const actor = await requireApprovedPage("/");
  const [facets, projectContext] = await Promise.all([
    loadFacets(),
    resolveCurrentProject(actor),
  ]);

  return (
    <div className="app">
      <TopBar />
      <CatalogShell
        facets={facets}
        signedIn
        currentProjectId={projectContext?.current?.id ?? null}
      />
    </div>
  );
}
