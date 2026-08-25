"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type PublisherRow = {
  id: string;
  name: string;
  email: string | null;
  telegram: string | null;
  reliability: number;
  onTimeRate: number | null;
  rejectionRate: number | null;
  _count: { sites: number };
};

function ReliabilityBadge({ score }: { score: number }) {
  const band = score >= 80 ? "good" : score >= 55 ? "ok" : "bad";
  return <span className={`rel rel-${band} mono`}>{score}</span>;
}

export function PublisherList({
  initial,
  canEdit,
}: {
  initial: PublisherRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [publishers, setPublishers] = useState(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/publishers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, telegram }),
    });

    if (!res.ok) {
      setError((await res.json()).error ?? "Could not add that publisher.");
      setBusy(false);
      return;
    }

    setName("");
    setEmail("");
    setTelegram("");

    const list = await fetch("/api/admin/publishers");
    if (list.ok) setPublishers((await list.json()).publishers);
    setBusy(false);
    router.refresh();
  }

  return (
    <main className="main projects-main">
      <p className="crumb">
        <Link href="/admin">← Internal</Link>
      </p>

      <div className="results-bar">
        <p className="count">
          <strong className="mono">{publishers.length}</strong> publishers
        </p>
      </div>

      {error && <p className="err">{error}</p>}

      <ul className="rows">
        {publishers.map((p) => (
          <li key={p.id} className="row queue-row">
            <div className="row-main">
              <div className="row-title">
                <Link className="domain" href={`/admin/publishers/${p.id}`}>
                  {p.name}
                </Link>
                <span className="tag-chan">{p._count.sites} sites</span>
              </div>
              {/* Contact details are internal only — never on an advertiser route. */}
              <p className="row-meta">
                {p.email ?? "no email"}
                {p.telegram && ` · ${p.telegram}`}
              </p>
            </div>

            <div className="margin-cell">
              <ReliabilityBadge score={p.reliability} />
              <span className="metric-lab">
                {p.onTimeRate === null ? "no history yet" : `${p.onTimeRate}% on time`}
              </span>
            </div>

            <div className="queue-actions">
              <Link className="link-btn" href={`/admin/publishers/${p.id}`}>
                Open
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {canEdit && (
        <form className="proj-new" onSubmit={create}>
          <h2>Add a publisher</h2>
          <div className="proj-new-grid">
            <label htmlFor="p-name">Name</label>
            <input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="p-email">Email</label>
            <input id="p-email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="p-telegram">Telegram</label>
            <input id="p-telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
          </div>
          <button className="btn" disabled={busy}>
            {busy ? "Saving…" : "Add publisher"}
          </button>
        </form>
      )}
    </main>
  );
}

type Detail = {
  id: string;
  name: string;
  email: string | null;
  telegram: string | null;
  payoutNotes?: string | null;
  reliability: number;
  onTimeRate: number | null;
  rejectionRate: number | null;
  avgDaysOverQuoted: number | null;
  deadLinkCount: number | null;
  sites: { id: string; domain: string; isActive: boolean }[];
  notes: { id: string; body: string; createdAt: string; actor: { email: string } | null }[];
};

export function PublisherDetail({ publisher, canEdit }: { publisher: Detail; canEdit: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState(publisher.notes);
  const [busy, setBusy] = useState(false);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);

    const res = await fetch(`/api/admin/publishers/${publisher.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note }),
    });

    if (res.ok) {
      const { note: created } = await res.json();
      setNotes([{ ...created, actor: null }, ...notes]);
      setNote("");
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <main className="main projects-main">
      <p className="crumb">
        <Link href="/admin/publishers">← All publishers</Link>
      </p>

      <div className="order-head">
        <div>
          <h1 style={{ fontFamily: "Archivo, sans-serif", fontSize: 19, margin: 0 }}>
            {publisher.name}
          </h1>
          <p className="row-meta">
            {publisher.email ?? "no email"}
            {publisher.telegram && ` · ${publisher.telegram}`}
          </p>
        </div>
        <div className="order-head-right">
          <ReliabilityBadge score={publisher.reliability} />
        </div>
      </div>

      {/* The score is computed, so show what it was computed from. */}
      <ul className="rows">
        <li className="row" style={{ gridTemplateColumns: "1fr auto" }}>
          <span>On-time publish rate</span>
          <span className="mono">
            {publisher.onTimeRate === null ? "—" : `${publisher.onTimeRate}%`}
          </span>
        </li>
        <li className="row" style={{ gridTemplateColumns: "1fr auto" }}>
          <span>Rejection rate</span>
          <span className="mono">{publisher.rejectionRate ?? 0}%</span>
        </li>
        <li className="row" style={{ gridTemplateColumns: "1fr auto" }}>
          <span>Average days over quoted turnaround</span>
          <span className="mono">{publisher.avgDaysOverQuoted ?? 0}</span>
        </li>
        <li className="row" style={{ gridTemplateColumns: "1fr auto" }}>
          <span>Links later found dead</span>
          <span className="mono">{publisher.deadLinkCount ?? 0}</span>
        </li>
      </ul>

      {canEdit && publisher.payoutNotes !== undefined && (
        <>
          <h2 style={{ fontFamily: "Archivo, sans-serif", fontSize: 14, margin: "24px 0 10px" }}>
            Payout notes
          </h2>
          <p className="row-meta" style={{ whiteSpace: "normal" }}>
            {publisher.payoutNotes || "None recorded."}
          </p>
        </>
      )}

      <h2 style={{ fontFamily: "Archivo, sans-serif", fontSize: 14, margin: "24px 0 10px" }}>
        Sites ({publisher.sites.length})
      </h2>
      <ul className="rows">
        {publisher.sites.map((s) => (
          <li key={s.id} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
            <span className="domain">{s.domain}</span>
            {!s.isActive && <span className="pill pill-cancelled">inactive</span>}
          </li>
        ))}
      </ul>

      <h2 style={{ fontFamily: "Archivo, sans-serif", fontSize: 14, margin: "24px 0 10px" }}>
        Correspondence
      </h2>
      <form className="proj-new" onSubmit={addNote}>
        <textarea
          className="csv-box"
          rows={3}
          placeholder="What was sent, agreed, or chased"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn btn-sm" disabled={busy || !note.trim()}>
          {busy ? "Saving…" : "Add note"}
        </button>
      </form>

      <ul className="rows" style={{ marginTop: 12 }}>
        {notes.map((n) => (
          <li key={n.id} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
            <div className="row-main">
              <p className="row-meta" style={{ whiteSpace: "normal" }}>
                {n.body}
              </p>
            </div>
            <span className="metric-lab">
              {new Date(n.createdAt).toLocaleString("en-GB")}
              {n.actor && ` · ${n.actor.email}`}
            </span>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="row">
            <span className="metric-lab">Nothing logged yet.</span>
          </li>
        )}
      </ul>
    </main>
  );
}
