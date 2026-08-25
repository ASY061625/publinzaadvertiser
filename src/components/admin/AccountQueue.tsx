"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Account = {
  id: string;
  email: string;
  name: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  jobRole: string | null;
  promoting: string | null;
  country: string | null;
  status: string;
  createdAt: string;
  statusDecidedAt: string | null;
  decidedByEmail: string | null;
  freeEmailDomain: boolean;
  waitingHours: number;
};

const TABS = [
  { key: "PENDING", label: "Awaiting review" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "SUSPENDED", label: "Suspended" },
] as const;

/** Someone waiting longer than a business day is losing the sale. */
function waitTone(hours: number): string {
  if (hours >= 24) return " overdue";
  if (hours >= 8) return " warn";
  return "";
}

export function AccountQueue({
  initial,
  counts,
}: {
  initial: Account[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<string>("PENDING");
  const [accounts, setAccounts] = useState(initial);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(next: string) {
    setTab(next);
    setError(null);
    const query = next === "PENDING" ? "" : `?status=${next}`;
    const res = await fetch(`/api/admin/accounts${query}`);
    if (res.ok) setAccounts((await res.json()).accounts);
  }

  async function decide(id: string, action: string) {
    setBusy(id);
    setError(null);

    const res = await fetch(`/api/admin/accounts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note: notes[id] ?? null }),
    });

    if (!res.ok) {
      setError((await res.json()).error ?? "Could not record that decision.");
      setBusy(null);
      return;
    }

    setAccounts((prev) => prev.filter((a) => a.id !== id));
    setBusy(null);
    router.refresh();
  }

  return (
    <main className="main projects-main">
      <p className="crumb">
        <Link href="/admin">← Internal</Link>
      </p>

      <h1 style={{ fontFamily: "Archivo, sans-serif", fontSize: 19, margin: "0 0 4px" }}>
        Account approvals
      </h1>
      <p className="row-meta" style={{ whiteSpace: "normal", marginBottom: 14 }}>
        Oldest first. Approval speed is a conversion metric — someone who waits three days
        has already bought elsewhere. Target same business day.
      </p>

      {error && <p className="err">{error}</p>}

      <div className="results-bar">
        <div className="sort">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={"btn-sm " + (tab === t.key ? "btn" : "btn-ghost")}
              onClick={() => load(t.key)}
            >
              {t.label}
              {counts[t.key] ? ` (${counts[t.key]})` : ""}
            </button>
          ))}
        </div>
      </div>

      <ul className="rows">
        {accounts.map((a) => (
          <li key={a.id} className="row queue-row">
            <div className="row-main">
              <div className="row-title">
                <span className="domain">{a.companyName || a.name || a.email}</span>
                {a.freeEmailDomain && a.status === "PENDING" && (
                  <span className="tag-nf">free email</span>
                )}
                {a.status === "PENDING" && (
                  <span className={"pill pill-item" + waitTone(a.waitingHours)}>
                    waiting {a.waitingHours}h
                  </span>
                )}
              </div>

              <p className="row-meta">
                {a.email}
                {a.jobRole && ` · ${a.jobRole}`}
                {a.country && ` · ${a.country}`}
              </p>

              {a.companyWebsite && (
                <p className="row-meta">
                  <a href={a.companyWebsite} target="_blank" rel="noopener noreferrer">
                    {a.companyWebsite}
                  </a>
                </p>
              )}

              {a.promoting && (
                <p className="row-meta" style={{ whiteSpace: "normal" }}>
                  Promoting: {a.promoting}
                </p>
              )}

              {a.statusDecidedAt && (
                <p className="row-meta">
                  {a.status.toLowerCase()} {new Date(a.statusDecidedAt).toLocaleDateString("en-GB")}
                  {a.decidedByEmail && ` by ${a.decidedByEmail}`}
                </p>
              )}
            </div>

            <div className="queue-actions">
              {a.status === "PENDING" && (
                <>
                  <input
                    aria-label={`Note for ${a.email}`}
                    placeholder="Note (optional)"
                    value={notes[a.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                  />
                  <div className="queue-moves">
                    <button
                      className="btn btn-sm"
                      disabled={busy === a.id}
                      onClick={() => decide(a.id, "approve")}
                    >
                      Approve
                    </button>
                    <button
                      className="btn-danger"
                      disabled={busy === a.id}
                      onClick={() => decide(a.id, "reject")}
                    >
                      Reject
                    </button>
                  </div>
                </>
              )}

              {a.status === "APPROVED" && (
                <button
                  className="link-btn danger"
                  disabled={busy === a.id}
                  onClick={() => decide(a.id, "suspend")}
                >
                  Suspend
                </button>
              )}

              {(a.status === "SUSPENDED" || a.status === "REJECTED") && (
                <button
                  className="link-btn"
                  disabled={busy === a.id}
                  onClick={() => decide(a.id, "reinstate")}
                >
                  Approve now
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {accounts.length === 0 && (
        <div className="empty">
          <p>
            {tab === "PENDING"
              ? "Nobody is waiting. That is the target."
              : "Nothing in this list."}
          </p>
        </div>
      )}
    </main>
  );
}
