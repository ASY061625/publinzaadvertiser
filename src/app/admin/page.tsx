import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/data/session";
import { isPricingAdmin } from "@/lib/data/actor";
import { listQueue } from "@/lib/data/admin-orders";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  // Guarded here as well as in the layout: they render concurrently, so a
  // layout-only notFound() still streams this page's markup into the 404.
  const actor = await requireAdminPage();
  const admin = isPricingAdmin(actor);

  const [sites, users, projects, overdue, linkAlerts, refundEligible, pendingAccounts] = await Promise.all([
    prisma.site.count({ where: { isActive: true } }),
    prisma.user.count(),
    prisma.project.count(),
    listQueue(actor, { overdueOnly: true }),
    prisma.linkAlert.count({ where: { resolvedAt: null } }),
    prisma.linkAlert.count({ where: { resolvedAt: null, refundEligibleAt: { not: null } } }),
    prisma.user.count({ where: { status: "PENDING", role: "ADVERTISER" } }),
  ]);

  return (
    <main className="main" style={{ padding: 24 }}>
      <h1 style={{ fontFamily: "Archivo, sans-serif", fontSize: 20, margin: "0 0 4px" }}>
        Internal
      </h1>
      <p className="row-meta" style={{ whiteSpace: "normal" }}>
        Signed in as {actor.email} · {actor.role}
      </p>

      {refundEligible > 0 && (
        <p className="warn-block" style={{ marginTop: 16 }}>
          <span>
            <strong>{refundEligible}</strong>{" "}
            {refundEligible === 1 ? "placement has" : "placements have"} failed three checks
            across three days and {refundEligible === 1 ? "is" : "are"} refund-eligible. Nothing
            refunds automatically — chase a replacement or issue the refund.{" "}
            <Link href="/admin/monitoring">Open link monitoring</Link>
          </span>
        </p>
      )}

      {pendingAccounts > 0 && (
        <p className="warn-block" style={{ marginTop: 16 }}>
          <span>
            <strong>{pendingAccounts}</strong>{" "}
            {pendingAccounts === 1 ? "account is" : "accounts are"} waiting for review. Nobody
            can see the catalog until someone approves them, and a signup that waits a day
            has usually bought elsewhere.{" "}
            <Link href="/admin/accounts">Open the approval queue</Link>
          </span>
        </p>
      )}

      {overdue.length > 0 && (
        <p className="warn-block" style={{ marginTop: 16 }}>
          <span>
            <strong>{overdue.length}</strong>{" "}
            {overdue.length === 1 ? "placement is" : "placements are"} past the quoted turnaround.{" "}
            <Link href="/admin/orders?overdue=true">Open the overdue queue</Link>
          </span>
        </p>
      )}

      <div className="admin-nav">
        <Link className="admin-card" href="/admin/orders">
          <strong>Order queue</strong>
          <span>Assign, chase, and move placements through the pipeline.</span>
        </Link>

        {/* Pricing screens are ADMIN-only and 404 for an EDITOR, so the links
            are not shown to them either — the guard is the data layer, this is
            just not advertising a dead end. */}
        {admin && (
          <>
            <Link className="admin-card" href="/admin/sites">
              <strong>Sites</strong>
              <span>Pricing, margin, activation. {sites} active.</span>
            </Link>
            <Link className="admin-card" href="/admin/import">
              <strong>Import catalog</strong>
              <span>Bulk CSV with a dry run before anything is written.</span>
            </Link>
          </>
        )}

        <Link className="admin-card" href="/admin/accounts">
          <strong>Account approvals</strong>
          <span>
            {pendingAccounts > 0
              ? `${pendingAccounts} account${pendingAccounts === 1 ? "" : "s"} awaiting review.`
              : "Nobody is waiting."}
          </span>
        </Link>

        <Link className="admin-card" href="/admin/publishers">
          <strong>Publishers</strong>
          <span>Contacts, correspondence, reliability scores.</span>
        </Link>

        <Link className="admin-card" href="/admin/monitoring">
          <strong>Link monitoring</strong>
          <span>
            {linkAlerts > 0
              ? `${linkAlerts} open alert${linkAlerts === 1 ? "" : "s"} on live links.`
              : "Every checked link is live."}
          </span>
        </Link>

        {admin && (
          <Link className="admin-card" href="/admin/audit">
            <strong>Audit log</strong>
            <span>Every admin write, with before and after.</span>
          </Link>
        )}
      </div>

      <ul className="rows" style={{ marginTop: 20 }}>
        <li className="row" style={{ gridTemplateColumns: "1fr auto" }}>
          <span>Active sites</span>
          <span className="mono">{sites}</span>
        </li>
        <li className="row" style={{ gridTemplateColumns: "1fr auto" }}>
          <span>Registered users</span>
          <span className="mono">{users}</span>
        </li>
        <li className="row" style={{ gridTemplateColumns: "1fr auto" }}>
          <span>Projects</span>
          <span className="mono">{projects}</span>
        </li>
      </ul>
    </main>
  );
}
