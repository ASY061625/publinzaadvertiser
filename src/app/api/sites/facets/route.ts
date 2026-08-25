import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { NOT_FOUND } from "@/lib/api-errors";
import { requireApprovedApi } from "@/lib/data/session";

export const dynamic = "force-dynamic";

// Option lists for the filter rail. Derived from live inventory so a country
// with no active sites never shows up as a dead checkbox.
export async function GET() {
  // Facet lists are inventory too: they reveal which countries and niches the
  // catalog covers, and how many of each. Gated exactly like the catalog.
  try {
    await requireApprovedApi();
  } catch {
    return NOT_FOUND();
  }

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
      FROM "Site" WHERE "isActive" = true
      GROUP BY country ORDER BY country
    `,
    prisma.$queryRaw<{ code: string; count: bigint }[]>`
      SELECT language AS code, COUNT(*)::bigint AS count
      FROM "Site" WHERE "isActive" = true
      GROUP BY language ORDER BY language
    `,
    prisma.$queryRaw<{ minPrice: number; maxPrice: number }[]>`
      SELECT MIN("priceCents")::int AS "minPrice", MAX("priceCents")::int AS "maxPrice"
      FROM "Site" WHERE "isActive" = true
    `,
  ]);

  return NextResponse.json({
    categories,
    countries: countries.map((c) => ({ code: c.code, count: Number(c.count) })),
    languages: languages.map((l) => ({ code: l.code, count: Number(l.count) })),
    priceMinCents: bounds[0]?.minPrice ?? 0,
    priceMaxCents: bounds[0]?.maxPrice ?? 0,
  });
}
