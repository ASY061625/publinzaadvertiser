-- Catalog read-path indexes.
--
-- Chosen by benchmarking the twelve filter combinations the catalog UI can
-- actually produce (scripts/bench-catalog.ts) against 50,000 seeded rows, then
-- keeping only the indexes pg_stat_user_indexes showed being scanned. An
-- expression index on COALESCE("organicTraffic", -1) was also tried and dropped
-- — zero scans, because the traffic sort is planned as a parallel top-N heapsort.
--
-- Prisma's schema language cannot express partial, expression, or GIN indexes,
-- so these live here rather than as @@index attributes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Default sort (domain rating, descending) and its keyset cursor comparison.
-- Coalesced to match the ORDER BY exactly, so sites with no metrics row still
-- take part in the ordering instead of dropping out of the keyset.
CREATE INDEX "idx_metric_dr_id"
  ON "SiteMetric" (COALESCE("domainRating", -1) DESC, "siteId" DESC);

-- DR band combined with a traffic floor — the most common quality filter pair.
CREATE INDEX "idx_metric_dr_tr"
  ON "SiteMetric" ("domainRating", "organicTraffic");

-- "Analytics-verified traffic" toggle. Partial, because only the true side is
-- ever filtered on.
CREATE INDEX "idx_metric_ga"
  ON "SiteMetric" ("siteId") WHERE "gaVerified" = true;

-- Price and turnaround sorts, including their keyset tuples. Partial on
-- isActive since the catalog never serves inactive sites.
CREATE INDEX "idx_site_price_id" ON "Site" ("priceCents", "id") WHERE "isActive";
CREATE INDEX "idx_site_turn_id"  ON "Site" ("turnaroundDays", "id") WHERE "isActive";

-- Domain search box (ILIKE '%term%'), which no b-tree index can serve.
CREATE INDEX "idx_site_domain_trgm" ON "Site" USING gin ("domain" gin_trgm_ops);

-- Restricted-topic acceptance, queried with the array containment operator.
CREATE INDEX "idx_site_sens" ON "Site" USING gin ("acceptsSensitive");

-- Topic filter's EXISTS subquery, which probes by category and then by site.
CREATE INDEX "idx_cos_category_site" ON "CategoryOnSite" ("categoryId", "siteId");
