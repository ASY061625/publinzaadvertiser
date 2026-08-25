"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCents } from "@/lib/format";
import { StatusPill } from "./OrderList";
import type { OrderView } from "@/lib/data/orders";

const ITEM_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  CONTENT_PENDING: "Content pending",
  SUBMITTED_TO_PUBLISHER: "With publisher",
  REVISION_REQUESTED: "Revision requested",
  PUBLISHED: "Published",
  VERIFIED: "Verified",
  REFUNDED: "Refunded",
  REJECTED: "Cancelled",
};

export type HistoryRow = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderDetail({
  order: initial,
  history,
}: {
  order: OrderView;
  history: Record<string, HistoryRow[]>;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(initial);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(itemId: string) {
    setBusy(itemId);
    setError(null);

    const res = await fetch(`/api/orders/${order.id}/items/${itemId}/cancel`, { method: "POST" });
    if (!res.ok) {
      setError((await res.json()).error ?? "Could not cancel that placement.");
      setBusy(null);
      return;
    }
    setOrder((await res.json()).order);
    setBusy(null);
    router.refresh();
  }

  return (
    <main className="main projects-main">
      <p className="crumb">
        <Link href="/orders">← All orders</Link>
      </p>

      <div className="order-head">
        <div>
          <h1 className="mono order-ref">{order.reference}</h1>
          <p className="row-meta">
            {order.projectName ?? "No project"} ·{" "}
            {order.placedAt ? `placed ${when(String(order.placedAt))}` : "not yet placed"}
          </p>
        </div>
        <div className="order-head-right">
          <StatusPill status={order.status} />
          <span className="mono foot-total">{formatCents(order.totalCents)}</span>
        </div>
      </div>

      {error && <p className="err">{error}</p>}

      <ul className="rows">
        {order.items.map((item) => {
          const rows = history[item.id] ?? [];
          const isOpen = openItem === item.id;

          return (
            <li key={item.id} className="row item-row">
              <div className="row-main">
                <div className="row-title">
                  <span className="domain">{item.domain}</span>
                  <span className={`pill pill-item pill-${item.status.toLowerCase()}`}>
                    {ITEM_LABEL[item.status] ?? item.status}
                  </span>
                </div>
                <p className="row-meta">
                  <span className="anchor">“{item.anchorText}”</span> → {item.targetUrl}
                  {item.contentSource === "PLATFORM" && " · we write it"}
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

              <div className="price">
                <span className="mono price-num">{formatCents(item.priceCents)}</span>
              </div>

              <div className="proj-actions">
                <button className="link-btn" onClick={() => setOpenItem(isOpen ? null : item.id)}>
                  {isOpen ? "Hide history" : "History"}
                </button>
                {/* Only a placement that has not been started can be cancelled. */}
                {item.status === "QUEUED" && (
                  <button
                    className="link-btn danger"
                    disabled={busy === item.id}
                    onClick={() => cancel(item.id)}
                  >
                    {busy === item.id ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </div>

              {isOpen && (
                <ol className="history">
                  {rows.map((h) => (
                    <li key={h.id}>
                      <span className="mono hist-when">{when(h.createdAt)}</span>
                      <span>
                        {h.fromStatus ? `${ITEM_LABEL[h.fromStatus] ?? h.fromStatus} → ` : ""}
                        <strong>{ITEM_LABEL[h.toStatus] ?? h.toStatus}</strong>
                      </span>
                      {h.note && <span className="hist-note">{h.note}</span>}
                    </li>
                  ))}
                  {rows.length === 0 && <li className="hist-note">No history yet.</li>}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
