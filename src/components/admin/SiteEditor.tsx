"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCents } from "@/lib/format";

type SiteRow = {
  id: string;
  domain: string;
  country: string;
  language: string;
  costCents: number;
  priceCents: number;
  marginCents: number;
  marginPct: number;
  turnaroundDays: number;
  isActive: boolean;
  publisher: { id: string; name: string; reliability: number } | null;
};

function centsFromInput(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

/** Live margin readout, in currency and percent, as PHASE4.md asks. */
function MarginReadout({ costCents, priceCents }: { costCents: number; priceCents: number }) {
  const marginCents = priceCents - costCents;
  const pct = priceCents > 0 ? Math.round((marginCents / priceCents) * 100) : 0;
  const bad = marginCents <= 0;

  return (
    <div className={"margin-readout" + (bad ? " bad" : "")}>
      <span className="mono">{formatCents(marginCents)}</span>
      <span className="metric-lab">margin ({pct}%)</span>
    </div>
  );
}

export function SiteList({ initial }: { initial: SiteRow[] }) {
  const router = useRouter();
  const [sites, setSites] = useState(initial);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      sites.filter(
        (s) =>
          (!q || s.domain.toLowerCase().includes(q.toLowerCase())) &&
          (showInactive || s.isActive)
      ),
    [sites, q, showInactive]
  );

  async function toggleActive(site: SiteRow) {
    setBusy(site.id);
    const res = await fetch(`/api/admin/sites/${site.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: site.isActive ? "deactivate" : "reactivate" }),
    });
    if (res.ok) {
      const { site: updated } = await res.json();
      setSites((prev) => prev.map((s) => (s.id === site.id ? { ...s, isActive: updated.isActive } : s)));
      router.refresh();
    }
    setBusy(null);
  }

  return (
    <main className="main projects-main">
      <div className="results-bar">
        <p className="count">
          <strong className="mono">{shown.length}</strong> sites
        </p>
        <div className="sort">
          <input
            className="mini-search"
            placeholder="Search domain"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ marginBottom: 0 }}
          />
          <label className="co-write">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span>Show inactive</span>
          </label>
          <Link className="btn btn-sm" href="/admin/sites/new">
            Add site
          </Link>
          <Link className="btn-ghost btn-sm" href="/admin/import">
            Import CSV
          </Link>
        </div>
      </div>

      <ul className="rows">
        {shown.map((s) => (
          <li key={s.id} className={"row queue-row" + (s.isActive ? "" : " row-inactive")}>
            <div className="row-main">
              <div className="row-title">
                <Link className="domain" href={`/admin/sites/${s.id}`}>
                  {s.domain}
                </Link>
                {!s.isActive && <span className="pill pill-cancelled">inactive</span>}
              </div>
              <p className="row-meta">
                {s.country} · {s.language} · publishes in {s.turnaroundDays}d
                {s.publisher && ` · ${s.publisher.name} (reliability ${s.publisher.reliability})`}
              </p>
            </div>

            <div className="margin-cell">
              <span className="mono">
                {formatCents(s.priceCents)} / {formatCents(s.costCents)}
              </span>
              <span className="metric-lab">
                margin {formatCents(s.marginCents)} ({s.marginPct}%)
              </span>
            </div>

            <div className="queue-actions">
              <Link className="link-btn" href={`/admin/sites/${s.id}`}>
                Edit
              </Link>
              {/* Never a delete — deactivating is the only removal there is. */}
              <button className="link-btn" disabled={busy === s.id} onClick={() => toggleActive(s)}>
                {s.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {shown.length === 0 && (
        <div className="empty">
          <p>No sites match.</p>
        </div>
      )}
    </main>
  );
}

type EditableSite = {
  id?: string;
  domain: string;
  country: string;
  language: string;
  costCents: number;
  priceCents: number;
  writingCents: number;
  turnaroundDays: number;
  isActive?: boolean;
  publisher?: { id: string; name: string; reliability: number; onTimeRate: number | null } | null;
  priceHistory?: {
    id: string;
    oldCostCents: number;
    newCostCents: number;
    oldPriceCents: number;
    newPriceCents: number;
    overrideReason: string | null;
    createdAt: string;
    actor: { email: string } | null;
  }[];
};

export function SiteForm({ site, isNew }: { site: EditableSite; isNew: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState(site);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof EditableSite>(k: K, v: EditableSite[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const lossMaking = form.priceCents <= form.costCents;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);

    const payload = {
      domain: form.domain,
      country: form.country,
      language: form.language,
      costCents: form.costCents,
      priceCents: form.priceCents,
      writingCents: form.writingCents,
      turnaroundDays: form.turnaroundDays,
      override,
      overrideReason,
    };

    const res = await fetch(isNew ? "/api/admin/sites" : `/api/admin/sites/${site.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      setError((await res.json()).error ?? "Could not save that site.");
      setBusy(false);
      return;
    }

    const { site: updated } = await res.json();
    setBusy(false);
    setSaved(true);
    if (isNew) router.push(`/admin/sites/${updated.id}`);
    else router.refresh();
  }

  return (
    <main className="main projects-main">
      <p className="crumb">
        <Link href="/admin/sites">← All sites</Link>
      </p>

      <h1 style={{ fontFamily: "Archivo, sans-serif", fontSize: 19, margin: "0 0 4px" }}>
        {isNew ? "Add a site" : form.domain}
      </h1>
      {form.publisher && (
        <p className="row-meta" style={{ marginBottom: 14 }}>
          {form.publisher.name} · reliability{" "}
          <strong>{form.publisher.reliability}</strong>
          {form.publisher.onTimeRate !== null && ` · ${form.publisher.onTimeRate}% on time`}
        </p>
      )}

      {error && <p className="err">{error}</p>}
      {saved && <p className="auth-hint">Saved.</p>}

      <div className="proj-new">
        <div className="proj-new-grid">
          <label htmlFor="s-domain">Domain</label>
          <input id="s-domain" value={form.domain} onChange={(e) => set("domain", e.target.value)} />

          <label htmlFor="s-country">Country (ISO-2)</label>
          <input
            id="s-country"
            maxLength={2}
            value={form.country}
            onChange={(e) => set("country", e.target.value.toUpperCase())}
          />

          <label htmlFor="s-language">Language (ISO-639-1)</label>
          <input
            id="s-language"
            maxLength={2}
            value={form.language}
            onChange={(e) => set("language", e.target.value.toLowerCase())}
          />

          <label htmlFor="s-turnaround">Turnaround (days)</label>
          <input
            id="s-turnaround"
            type="number"
            min={1}
            value={form.turnaroundDays}
            onChange={(e) => set("turnaroundDays", Number(e.target.value))}
          />
        </div>

        {/* Cost, price and margin side by side, per PHASE4.md. */}
        <div className="pricing-grid">
          <div>
            <label className="range-lab" htmlFor="s-cost">
              Cost (what we pay)
            </label>
            <input
              id="s-cost"
              type="number"
              min={0}
              step="0.01"
              value={(form.costCents / 100).toString()}
              onChange={(e) => set("costCents", centsFromInput(e.target.value))}
            />
          </div>
          <div>
            <label className="range-lab" htmlFor="s-price">
              Price (what they pay)
            </label>
            <input
              id="s-price"
              type="number"
              min={0}
              step="0.01"
              value={(form.priceCents / 100).toString()}
              onChange={(e) => set("priceCents", centsFromInput(e.target.value))}
            />
          </div>
          <MarginReadout costCents={form.costCents} priceCents={form.priceCents} />
        </div>

        {lossMaking && (
          <div className="override-box">
            <p>
              Price does not beat cost. Selling at a loss should be a decision, not a typo — tick
              the box and say why.
            </p>
            <label className="co-write">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              <span>Save at a loss anyway</span>
            </label>
            {override && (
              <input
                placeholder="Reason (recorded against this site)"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            )}
          </div>
        )}

        <button className="btn" disabled={busy} onClick={save}>
          {busy ? "Saving…" : isNew ? "Create site" : "Save changes"}
        </button>
      </div>

      {form.priceHistory && form.priceHistory.length > 0 && (
        <>
          <h2 style={{ fontFamily: "Archivo, sans-serif", fontSize: 14, margin: "24px 0 10px" }}>
            Price history
          </h2>
          <ul className="rows">
            {form.priceHistory.map((h) => (
              <li key={h.id} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                <div className="row-main">
                  <p className="row-meta" style={{ whiteSpace: "normal" }}>
                    cost {formatCents(h.oldCostCents)} → {formatCents(h.newCostCents)} · price{" "}
                    {formatCents(h.oldPriceCents)} → {formatCents(h.newPriceCents)}
                    {h.actor && ` · ${h.actor.email}`}
                  </p>
                  {h.overrideReason && (
                    <p className="co-warn">Loss-making override: {h.overrideReason}</p>
                  )}
                </div>
                <span className="metric-lab">
                  {new Date(h.createdAt).toLocaleDateString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
