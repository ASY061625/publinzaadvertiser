"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/format";
import type { OrderView } from "@/lib/data/orders";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_PAYMENT: "Awaiting payment",
  IN_PROGRESS: "In progress",
  PARTIALLY_COMPLETE: "Partly complete",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${status.toLowerCase()}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function OrderList({
  orders,
  projects,
}: {
  orders: (OrderView & { itemCount: number })[];
  projects: { id: string; name: string }[];
}) {
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");

  // Filtering a page of already-loaded orders; the server route supports the
  // same filters for when this list grows past one page.
  const shown = useMemo(
    () =>
      orders.filter(
        (o) => (!projectId || o.projectId === projectId) && (!status || o.status === status)
      ),
    [orders, projectId, status]
  );

  return (
    <main className="main projects-main">
      <div className="results-bar">
        <p className="count">
          <strong className="mono">{shown.length}</strong>{" "}
          {shown.length === 1 ? "order" : "orders"}
        </p>
        <div className="sort">
          <label htmlFor="f-project">Project</label>
          <select id="f-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <label htmlFor="f-status">Status</label>
          <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <p>No orders yet.</p>
          <Link className="btn-ghost" href="/">
            Browse the catalog
          </Link>
        </div>
      ) : (
        <ul className="rows">
          {shown.map((o) => (
            <li key={o.id} className="row order-row">
              <div className="row-main">
                <div className="row-title">
                  <Link className="domain" href={`/orders/${o.id}`}>
                    {o.reference}
                  </Link>
                  <StatusPill status={o.status} />
                </div>
                <p className="row-meta">
                  {o.projectName ?? "No project"} ·{" "}
                  {new Date(o.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  · {o.itemCount} {o.itemCount === 1 ? "placement" : "placements"}
                </p>
              </div>
              <div className="price">
                <span className="mono price-num">{formatCents(o.totalCents)}</span>
                <span className="metric-lab">total</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
