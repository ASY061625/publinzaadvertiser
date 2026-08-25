"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCents } from "@/lib/format";
import type { CartView } from "@/lib/data/cart";

type Draft = { targetUrl: string; anchorText: string; contentSource: "ADVERTISER" | "PLATFORM" };

export function Checkout({
  cart,
  projects,
  defaultProjectId,
}: {
  cart: CartView;
  projects: { id: string; name: string; targetUrl: string }[];
  defaultProjectId: string | null;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      cart.lines.map((l) => [
        l.id,
        { targetUrl: "", anchorText: "", contentSource: "ADVERTISER" as const },
      ])
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Generated once per mounted checkout. Resubmitting — a double-click, or a
  // back-and-resubmit — reuses the same key, so the server returns the order it
  // already created instead of making a second one.
  const idempotencyKey = useRef(
    `co-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  ).current;

  const project = projects.find((p) => p.id === projectId);
  const projectHost = useMemo(() => {
    try {
      return project ? new URL(project.targetUrl).host : null;
    } catch {
      return null;
    }
  }, [project]);

  const set = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const total = cart.lines.reduce((n, l) => {
    const d = drafts[l.id];
    return n + l.priceCents + (d?.contentSource === "PLATFORM" ? l.writingCents : 0);
  }, 0);

  const ready =
    projectId &&
    cart.lines.length > 0 &&
    cart.lines.every((l) => drafts[l.id]?.targetUrl.trim() && drafts[l.id]?.anchorText.trim());

  /** Host mismatch is a warning, not a block — agencies point at subdomains. */
  function hostWarning(url: string): string | null {
    if (!url.trim() || !projectHost) return null;
    try {
      const host = new URL(url).host;
      return host.toLowerCase() === projectHost.toLowerCase()
        ? null
        : `${host} is not ${projectHost}`;
    } catch {
      return "Not a valid absolute URL";
    }
  }

  async function place() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey,
        projectId,
        items: cart.lines.map((l) => ({
          siteId: l.siteId,
          targetUrl: drafts[l.id].targetUrl,
          anchorText: drafts[l.id].anchorText,
          contentSource: drafts[l.id].contentSource,
        })),
      }),
    });

    if (!res.ok) {
      setError((await res.json()).error ?? "Could not place that order.");
      setBusy(false);
      return;
    }

    const order = await res.json();
    router.push(`/orders/${order.id}`);
    router.refresh();
  }

  if (cart.lines.length === 0) {
    return (
      <main className="main projects-main">
        <div className="empty">
          <p>Your cart is empty.</p>
          <Link className="btn-ghost" href="/">
            Browse the catalog
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="main projects-main">
      <div className="results-bar">
        <p className="count">
          <strong className="mono">{cart.lines.length}</strong>{" "}
          {cart.lines.length === 1 ? "placement" : "placements"}
        </p>
        <div className="sort">
          <label htmlFor="co-project">Project</label>
          <select id="co-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {cart.duplicates.length > 0 && (
        <p className="warn-block">
          {cart.duplicates.map((d) => (
            <span key={`${d.siteId}-${d.projectId}`}>
              {d.domain} appears {d.count} times for {d.projectName}. That is occasionally
              deliberate — worth a look before placing.
            </span>
          ))}
        </p>
      )}

      {error && <p className="err">{error}</p>}

      <ul className="rows">
        {cart.lines.map((line) => {
          const d = drafts[line.id];
          const warning = hostWarning(d?.targetUrl ?? "");

          return (
            <li key={line.id} className="row co-line">
              <div className="row-main">
                <div className="row-title">
                  <span className="domain">{line.domain}</span>
                  <span className="tag-chan">{line.turnaroundDays}d</span>
                </div>
                <div className="co-fields">
                  <input
                    aria-label={`Target URL for ${line.domain}`}
                    placeholder="Target URL"
                    value={d?.targetUrl ?? ""}
                    onChange={(e) => set(line.id, { targetUrl: e.target.value })}
                  />
                  <input
                    aria-label={`Anchor text for ${line.domain}`}
                    placeholder="Anchor text"
                    maxLength={120}
                    value={d?.anchorText ?? ""}
                    onChange={(e) => set(line.id, { anchorText: e.target.value })}
                  />
                  <label className="co-write">
                    <input
                      type="checkbox"
                      checked={d?.contentSource === "PLATFORM"}
                      onChange={(e) =>
                        set(line.id, {
                          contentSource: e.target.checked ? "PLATFORM" : "ADVERTISER",
                        })
                      }
                    />
                    <span>We write it (+{formatCents(line.writingCents)})</span>
                  </label>
                </div>
                {warning && <p className="co-warn">{warning}</p>}
              </div>

              <div className="price">
                <span className="mono price-num">
                  {formatCents(
                    line.priceCents + (d?.contentSource === "PLATFORM" ? line.writingCents : 0)
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="co-foot">
        <div>
          <span className="tray-lab">Total</span>
          <span className="mono foot-total">{formatCents(total)}</span>
        </div>
        <button className="btn" disabled={!ready || busy} onClick={place}>
          {busy ? "Placing…" : ready ? "Place order" : "Add a URL and anchor for each site"}
        </button>
      </div>
      <p className="auth-hint">
        No payment in this phase. Funds and invoices arrive later; placing an order now sends it
        straight to fulfilment.
      </p>
    </main>
  );
}
