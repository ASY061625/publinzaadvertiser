import Link from "next/link";
import { requirePricingAdminPage } from "@/lib/data/session";
import { listAuditLog } from "@/lib/data/audit";

export const dynamic = "force-dynamic";

/**
 * ADMIN only: before/after snapshots contain cost and margin, so an EDITOR must
 * not reach this even though they are staff.
 */
export default async function AuditPage() {
  const actor = await requirePricingAdminPage();
  const entries = await listAuditLog(actor, {});

  return (
    <div className="shell shell-narrow">
      <main className="main projects-main">
        <p className="crumb">
          <Link href="/admin">← Internal</Link>
        </p>

        <div className="results-bar">
          <p className="count">
            <strong className="mono">{entries.length}</strong> most recent admin writes
          </p>
        </div>

        <ul className="rows">
          {entries.map((e) => (
            <li key={e.id} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
              <div className="row-main">
                <div className="row-title">
                  <span className="domain mono">{e.action}</span>
                  <span className="tag-chan">{e.entityType}</span>
                </div>
                <p className="row-meta">
                  {e.actor?.email ?? "system"}
                  {e.entityId && ` · ${e.entityId}`}
                </p>
              </div>
              <span className="metric-lab">{new Date(e.createdAt).toLocaleString("en-GB")}</span>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="row">
              <span className="metric-lab">Nothing recorded yet.</span>
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
