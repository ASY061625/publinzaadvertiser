-- Complements 20260820000100_catalog_indexes.
--
-- Both are partial on "isActive": the catalog never serves inactive sites, so
-- they stay out of the index entirely.

-- Country is the most-used facet, and price is the most-used ordering within a
-- country. Leading with country lets a country-scoped browse read price order
-- straight out of the index.
CREATE INDEX "site_active_price" ON "Site" ("country", "priceCents") WHERE "isActive";

-- "Publishes within N days, cheapest first" — the turnaround filter paired with
-- the price the advertiser is actually comparing on.
CREATE INDEX "site_active_turnaround" ON "Site" ("turnaroundDays", "priceCents") WHERE "isActive";
