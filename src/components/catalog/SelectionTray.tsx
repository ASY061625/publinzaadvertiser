"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BAND_LABELS, countryName, drBand, formatCents } from "@/lib/format";
import type { CatalogSite } from "./types";

// Below this a "concentration" reading is just noise — three sites from one
// country is a coincidence, not a pattern worth warning about.
const MIN_BATCH_FOR_WARNING = 5;
const CONCENTRATION_THRESHOLD = 0.4;

export function SelectionTray({
  chosen,
  onClear,
  currentProjectId,
  signedIn,
}: {
  chosen: CatalogSite[];
  onClear: () => void;
  currentProjectId?: string | null;
  signedIn?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (chosen.length === 0) return null;

  /**
   * The selection lives in client state while browsing; only on "Review order"
   * is it written to the server-side cart, which is what survives a device
   * switch. Sites are added one line each, so two placements on one site stay
   * two lines and the duplicate warning can see them.
   */
  async function review() {
    if (!signedIn) {
      router.push("/login?next=%2F");
      return;
    }
    if (!currentProjectId) {
      setError("Add a project first — a placement has to point somewhere.");
      return;
    }

    setBusy(true);
    setError(null);

    for (const site of chosen) {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: site.id, projectId: currentProjectId }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Could not build your cart.");
        setBusy(false);
        return;
      }
    }

    router.push("/checkout");
  }

  // Integer cents throughout — the only division happens inside formatCents.
  const subtotalCents = chosen.reduce((n, s) => n + s.priceCents, 0);

  const rated = chosen.filter((s) => s.metrics?.domainRating != null);
  const avgDr = rated.length
    ? Math.round(rated.reduce((n, s) => n + s.metrics!.domainRating!, 0) / rated.length)
    : 0;

  const bands = [0, 0, 0, 0];
  for (const s of chosen) bands[drBand(s.metrics?.domainRating ?? null)]++;

  const countryCounts = new Map<string, number>();
  for (const s of chosen) countryCounts.set(s.country, (countryCounts.get(s.country) ?? 0) + 1);

  const topCountry = [...countryCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const concentrated =
    chosen.length >= MIN_BATCH_FOR_WARNING &&
    topCountry &&
    topCountry[1] / chosen.length > CONCENTRATION_THRESHOLD;

  return (
    <div className="tray">
      <div className="tray-in">
        <div className="tray-stat">
          <span className="tray-num mono">{chosen.length}</span>
          <span className="tray-lab">sites</span>
        </div>
        <div className="tray-stat">
          <span className="tray-num mono">{formatCents(subtotalCents)}</span>
          <span className="tray-lab">subtotal</span>
        </div>
        <div className="tray-stat">
          <span className="tray-num mono">{avgDr || "—"}</span>
          <span className="tray-lab">avg DR</span>
        </div>

        <div className="hist" aria-label="Domain rating spread of your selection">
          {bands.map((n, i) => (
            <div key={BAND_LABELS[i]} className="hist-col">
              <div className="hist-bar" style={{ height: Math.max(3, (n / chosen.length) * 34) }} />
              <span className="hist-lab">{BAND_LABELS[i]}</span>
            </div>
          ))}
        </div>

        <div className="tray-stat">
          <span className="tray-num mono">{countryCounts.size}</span>
          <span className="tray-lab">countries</span>
        </div>

        {concentrated && (
          <p className="warn">
            {Math.round((topCountry[1] / chosen.length) * 100)}% of this batch is{" "}
            {countryName(topCountry[0])}. Spread it wider unless that market is the target.
          </p>
        )}

        {error && <p className="warn">{error}</p>}

        <div className="tray-actions">
          <button className="btn-ghost" onClick={onClear}>
            Clear
          </button>
          <button className="btn" disabled={busy} onClick={review}>
            {busy ? "Building cart…" : "Review order"}
          </button>
        </div>
      </div>
    </div>
  );
}
