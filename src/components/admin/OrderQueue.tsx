"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@/lib/format";
import type { QueueItem } from "@/lib/data/admin-orders";

const ITEM_STATUSES = [
  "QUEUED",
  "CONTENT_PENDING",
  "SUBMITTED_TO_PUBLISHER",
  "REVISION_REQUESTED",
  "PUBLISHED",
  "VERIFIED",
  "REFUNDED",
  "REJECTED",
] as const;

// Mirrors ALLOWED_TRANSITIONS so the UI only offers moves the server accepts.
// The server is still the authority — this just avoids obvious dead ends.
const NEXT: Record<string, string[]> = {
  QUEUED: ["CONTENT_PENDING", "SUBMITTED_TO_PUBLISHER", "REJECTED"],
  CONTENT_PENDING: ["SUBMITTED_TO_PUBLISHER", "REJECTED"],
  SUBMITTED_TO_PUBLISHER: ["PUBLISHED", "REVISION_REQUESTED", "REJECTED"],
  REVISION_REQUESTED: ["SUBMITTED_TO_PUBLISHER", "REJECTED"],
  PUBLISHED: ["VERIFIED", "REVISION_REQUESTED"],
  VERIFIED: ["REFUNDED"],
  REJECTED: [],
  REFUNDED: [],
};

type Editor = { id: string; email: string; name: string | null };

export function OrderQueue({
  initialItems,
  editors,
  counts,
}: {
  initialItems: QueueItem[];
  editors: Editor[];
  counts: Record<string, number>;
}) {
  const [items, setItems] = useState(initialItems);
  const [tallies, setTallies] = useState(counts);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { url: string; note: string }>>({});

  const reload = useCallback(async (nextStatus: string) => {
    const qs = nextStatus ? `?status=${nextStatus}` : "";
    const res = await fetch(`/api/admin/orders${qs}`);
    if (!res.ok) return;
    const body = await res.json();
    setItems(body.items);
    setTallies(body.counts);
  }, []);

  useEffect(() => {
    void reload(status);
  }, [status, reload]);

  const draftFor = (id: string) => draft[id] ?? { url: "", note: "" };
  const setDraftFor = (id: string, patch: Partial<{ url: string; note: string }>) =>
    setDraft((d) => ({ ...d, [id]: { ...draftFor(id), ...patch } }));

  async function move(item: QueueItem, to: string) {
    setBusy(item.id);
    setError(null);

    const { url, note } = draftFor(item.id);
    const res = await fetch(`/api/admin/items/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: to, publishedUrl: url || null, note: note || null }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "That change was refused.");
      setBusy(null);
      return;
    }

    setDraft((d) => ({ ...d, [item.id]: { url: "", note: "" } }));
    await reload(status);
    setBusy(null);
  }

  async function assign(item: QueueItem, editorId: string) {
    setBusy(item.id);
    setError(null);

    const res = await fetch(`/api/admin/items/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignedToId: editorId || null }),
    });
    if (!res.ok) setError("Could not assign that placement.");
    await reload(status);
    setBusy(null);
  }

  return (
    <main className="main projects-main">
      <div className="results-bar">
        <p className="count">
          <strong className="mono">{items.length}</strong> placements
        </p>
        <div className="sort">
          <label htmlFor="q-status">Status</label>
          <select id="q-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All ({Object.values(tallies).reduce((a, b) => a + b, 0)})</option>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()} ({tallies[s] ?? 0})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="err">{error}</p>}

      {items.length === 0 ? (
        <div className="empty">
          <p>Nothing in the queue for this filter.</p>
        </div>
      ) : (
        <ul className="rows">
          {items.map((item) => {
            const next = NEXT[item.status] ?? [];
            const needsUrl = next.includes("PUBLISHED");

            return (
              <li key={item.id} className="row queue-row">
                <div className="row-main">
                  <div className="row-title">
                    <span className="domain">{item.domain}</span>
                    <span className={`pill pill-item pill-${item.status.toLowerCase()}`}>
                      {item.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <span className="tag-chan mono">{item.orderReference}</span>
                  </div>
                  <p className="row-meta">
                    {item.advertiserEmail} · {item.projectName ?? "no project"} ·{" "}
                    <span className="anchor">“{item.anchorText}”</span> → {item.targetUrl}
                  </p>
                  {item.publishedUrl && (
                    <p className="row-meta">
                      Live at{" "}
                      <a href={item.publishedUrl} target="_blank" rel="noopener noreferrer">
                        {item.publishedUrl}
                      </a>
                    </p>
                  )}
                </div>

                {/* Cost and margin arrive only for an ADMIN — the server omits
                    the fields entirely for an EDITOR, so this renders price alone. */}
                <div className="margin-cell">
                  {item.costCents === undefined ? (
                    <>
                      <span className="mono">{formatCents(item.priceCents)}</span>
                      <span className="metric-lab">price</span>
                    </>
                  ) : (
                    <>
                      <span className="mono">
                        {formatCents(item.priceCents)} / {formatCents(item.costCents)}
                      </span>
                      <span className="metric-lab">
                        margin {formatCents(item.marginCents ?? 0)} ({item.marginPct ?? 0}%)
                      </span>
                    </>
                  )}
                </div>

                <div className="queue-actions">
                  <select
                    aria-label="Assign to editor"
                    value={item.assignedToId ?? ""}
                    disabled={busy === item.id}
                    onChange={(e) => assign(item, e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {editors.map((ed) => (
                      <option key={ed.id} value={ed.id}>
                        {ed.name || ed.email}
                      </option>
                    ))}
                  </select>

                  {needsUrl && (
                    <input
                      aria-label={`Published URL for ${item.domain}`}
                      placeholder="Published URL"
                      value={draftFor(item.id).url}
                      onChange={(e) => setDraftFor(item.id, { url: e.target.value })}
                    />
                  )}

                  <input
                    aria-label={`Note for ${item.domain}`}
                    placeholder="Note (optional)"
                    value={draftFor(item.id).note}
                    onChange={(e) => setDraftFor(item.id, { note: e.target.value })}
                  />

                  <div className="queue-moves">
                    {next.length === 0 ? (
                      <span className="metric-lab">terminal</span>
                    ) : (
                      next.map((to) => (
                        <button
                          key={to}
                          className="btn btn-sm"
                          disabled={busy === item.id}
                          onClick={() => move(item, to)}
                        >
                          {to.replace(/_/g, " ").toLowerCase()}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
