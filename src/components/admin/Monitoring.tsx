"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCents } from "@/lib/format";

type Alert = {
  id: string;
  orderItemId: string;
  outcome: string;
  openedAt: string;
  refundEligibleAt: string | null;
  acknowledgedBy: string | null;
  orderItem: {
    publishedUrl: string | null;
    targetUrl: string;
    anchorText: string;
    priceCents: number;
    order: { reference: string; user: { email: string } };
    site: { domain: string; publisher: { name: string } | null };
  };
};

type Review = {
  id: string;
  orderItemId: string;
  outcome: string;
  httpStatus: number | null;
  note: string | null;
  attempt: number;
  checkedAt: string;
  orderItem: { publishedUrl: string | null; site: { domain: string } };
};

type Spend = {
  day: string;
  lookups: number;
  spentMinor: number;
  capMinor: number;
  capHitAt: string | null;
} | null;

const OUTCOME_LABEL: Record<string, string> = {
  LINK_ABSENT: "link removed",
  ARTICLE_DELETED: "article deleted",
  REL_CHANGED: "made nofollow",
  ANCHOR_CHANGED: "anchor changed",
  ARTICLE_MOVED: "article moved",
  URL_CHANGED: "url changed",
  DEINDEXED: "deindexed",
  BLOCKED: "blocked",
  FETCH_ERROR: "fetch error",
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Monitoring({
  alerts: initialAlerts,
  manualReview,
  metricsSpend,
}: {
  alerts: Alert[];
  manualReview: Review[];
  metricsSpend: Spend;
}) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initialAlerts);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);

    const res = await fetch("/api/admin/monitoring", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      setError((await res.json()).error ?? "That action failed.");
      setBusy(null);
      return;
    }

    const refreshed = await fetch("/api/admin/monitoring");
    if (refreshed.ok) setAlerts((await refreshed.json()).alerts);
    setBusy(null);
    router.refresh();
  }

  const eligible = alerts.filter((a) => a.refundEligibleAt);

  return (
    <main className="main projects-main">
      <p className="crumb">
        <Link href="/admin">← Internal</Link>
      </p>

      {metricsSpend?.capHitAt && (
        <p className="warn-block">
          <span>
            Metrics spend cap reached at {when(metricsSpend.capHitAt)} —{" "}
            {formatCents(metricsSpend.spentMinor)} of {formatCents(metricsSpend.capMinor)} today.
            Refreshes are paused until tomorrow.
          </span>
        </p>
      )}

      <div className="results-bar">
        <p className="count">
          <strong className="mono">{alerts.length}</strong> open link alerts
          {eligible.length > 0 && (
            <>
              {" · "}
              <strong className="mono overdue">{eligible.length}</strong> refund-eligible
            </>
          )}
        </p>
      </div>

      {error && <p className="err">{error}</p>}

      {alerts.length === 0 ? (
        <div className="empty">
          <p>Every checked link is live.</p>
        </div>
      ) : (
        <ul className="rows">
          {alerts.map((a) => (
            <li key={a.id} className="row queue-row">
              <div className="row-main">
                <div className="row-title">
                  <span className="domain">{a.orderItem.site.domain}</span>
                  <span className="pill pill-rejected">
                    {OUTCOME_LABEL[a.outcome] ?? a.outcome.toLowerCase()}
                  </span>
                  <span className="tag-chan mono">{a.orderItem.order.reference}</span>
                  {a.refundEligibleAt && <span className="pill pill-cancelled">refund-eligible</span>}
                </div>
                <p className="row-meta">
                  since {when(a.openedAt)} · {a.orderItem.order.user.email}
                  {a.orderItem.site.publisher && ` · ${a.orderItem.site.publisher.name}`}
                </p>
                {a.orderItem.publishedUrl && (
                  <p className="row-meta">
                    <a href={a.orderItem.publishedUrl} target="_blank" rel="noopener noreferrer">
                      {a.orderItem.publishedUrl}
                    </a>
                  </p>
                )}
              </div>

              <div className="margin-cell">
                <span className="mono">{formatCents(a.orderItem.priceCents)}</span>
                <span className="metric-lab">at risk</span>
              </div>

              <div className="queue-actions">
                {/* Nothing auto-refunds. Staff choose between chasing a
                    replacement — usually better for both sides — and refunding. */}
                <button
                  className="btn btn-sm"
                  disabled={busy === a.id}
                  onClick={() => act({ recheckItemId: a.orderItemId }, a.id)}
                >
                  Re-check now
                </button>
                <button
                  className="link-btn"
                  disabled={busy === a.id}
                  onClick={() => act({ alertId: a.id }, a.id)}
                >
                  Acknowledge
                </button>
                <button
                  className="link-btn"
                  disabled={busy === a.id}
                  onClick={() =>
                    act({ alertId: a.id, resolution: "Replacement placement agreed" }, a.id)
                  }
                >
                  Replacement agreed
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ fontFamily: "Archivo, sans-serif", fontSize: 14, margin: "24px 0 10px" }}>
        Manual review ({manualReview.length})
      </h2>
      <p className="row-meta" style={{ whiteSpace: "normal", marginBottom: 10 }}>
        Checks that could not be completed — usually a publisher blocking datacentre IPs. These
        are not failed links and never count toward a refund.
      </p>
      <ul className="rows">
        {manualReview.map((r) => (
          <li key={r.id} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
            <div className="row-main">
              <div className="row-title">
                <span className="domain">{r.orderItem.site.domain}</span>
                <span className="pill pill-published">
                  {OUTCOME_LABEL[r.outcome] ?? r.outcome.toLowerCase()}
                </span>
              </div>
              <p className="row-meta">
                {r.httpStatus ? `HTTP ${r.httpStatus}` : "no response"} · {r.attempt} attempts
                {r.note && ` · ${r.note}`}
              </p>
            </div>
            <span className="metric-lab">{when(r.checkedAt)}</span>
          </li>
        ))}
        {manualReview.length === 0 && (
          <li className="row">
            <span className="metric-lab">Nothing awaiting review.</span>
          </li>
        )}
      </ul>
    </main>
  );
}
