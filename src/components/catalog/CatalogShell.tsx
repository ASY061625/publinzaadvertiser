"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FilterRail } from "./FilterRail";
import { SelectionTray } from "./SelectionTray";
import { SiteRow } from "./SiteRow";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  toQueryString,
  type CatalogSite,
  type Facets,
  type FilterState,
} from "./types";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

type Page = { sites: CatalogSite[]; nextCursor: string | null; total: number };

export function CatalogShell({
  facets,
  currentProjectId,
  signedIn,
}: {
  facets: Facets;
  currentProjectId?: string | null;
  signedIn?: boolean;
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [sort, setSort] = useState("dr");
  const [railOpen, setRailOpen] = useState(false);

  const [sites, setSites] = useState<CatalogSite[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected sites are kept whole, not as ids, so the tray keeps its numbers
  // when a site scrolls out of the current filter's results.
  const [selected, setSelected] = useState<Map<string, CatalogSite>>(new Map());

  // Every filter change supersedes the request in flight; without this a slow
  // early response can land after a fast later one and show the wrong rows.
  const requestId = useRef(0);

  const query = toQueryString(filters, sort, PAGE_SIZE);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sites?${query}`);
        const body = await res.json();
        if (id !== requestId.current) return;

        if (!res.ok) {
          setError(body.error ?? "Could not load the catalog.");
          setSites([]);
          setTotal(0);
          setCursor(null);
          return;
        }

        const page = body as Page;
        setSites(page.sites);
        setTotal(page.total);
        setCursor(page.nextCursor);
      } catch {
        if (id === requestId.current) setError("Could not reach the catalog.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/sites?${query}&cursor=${encodeURIComponent(cursor)}`);
      const body = await res.json();
      if (id !== requestId.current) return;
      if (!res.ok) {
        setError(body.error ?? "Could not load more sites.");
        return;
      }
      const page = body as Page;
      setSites((prev) => [...prev, ...page.sites]);
      setCursor(page.nextCursor);
    } catch {
      if (id === requestId.current) setError("Could not reach the catalog.");
    } finally {
      if (id === requestId.current) setLoadingMore(false);
    }
  }, [cursor, loadingMore, query]);

  const toggleSite = (site: CatalogSite) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(site.id)) next.delete(site.id);
      else next.set(site.id, site);
      return next;
    });

  const active = activeFilterCount(filters);

  return (
    <>
      <div className="shell">
        <button className="rail-toggle" onClick={() => setRailOpen(!railOpen)}>
          {railOpen ? "Hide filters" : `Filters${active ? ` (${active})` : ""}`}
        </button>

        <FilterRail filters={filters} onChange={setFilters} facets={facets} open={railOpen} />

        <main className="main">
          <div className="results-bar">
            <p className="count">
              <strong className="mono">{total.toLocaleString("en-US")}</strong>{" "}
              {total === 1 ? "site" : "sites"} match
            </p>
            <div className="sort">
              <label htmlFor="sort">Sort</label>
              <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="dr">Domain rating</option>
                <option value="traffic">Traffic</option>
                <option value="price_asc">Price, low to high</option>
                <option value="price_desc">Price, high to low</option>
                <option value="turnaround">Fastest turnaround</option>
              </select>
            </div>
          </div>

          {error && <p className="err">{error}</p>}

          {loading ? (
            <p className="loading-note">Loading catalog…</p>
          ) : sites.length === 0 && !error ? (
            <div className="empty">
              <p>No sites match these filters.</p>
              <button className="btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <ul className="rows">
                {sites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    selected={selected.has(site.id)}
                    onToggle={() => toggleSite(site)}
                  />
                ))}
              </ul>

              {cursor && (
                <div className="more">
                  <button className="btn-more" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : `Show more (${sites.length} of ${total.toLocaleString("en-US")})`}
                  </button>
                </div>
              )}
            </>
          )}

          <div className="tray-space" />
        </main>
      </div>

      <SelectionTray
        chosen={[...selected.values()]}
        onClear={() => setSelected(new Map())}
        currentProjectId={currentProjectId}
        signedIn={signedIn}
      />
    </>
  );
}
