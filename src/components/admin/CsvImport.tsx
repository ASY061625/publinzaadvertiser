"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ImportError = { line: number; domain: string | null; column: string | null; message: string };
type Preview = {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  errors: ImportError[];
};

const TEMPLATE =
  "domain,country,language,categories,cost,price,writing_price,turnaround_days,link_type," +
  "max_links,min_words,guarantee_days,accepts_sensitive,publisher_name,publisher_email," +
  "publisher_telegram,notes";

export function CsvImport({ history }: { history: { id: string; fileName: string; createdCount: number; updatedCount: number; unchangedCount: number; createdAt: string; actor: { email: string } | null }[] }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("upload.csv");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Preview | null>(null);

  async function readFile(file: File) {
    setFileName(file.name);
    setCsv(await file.text());
    setPreview(null);
    setDone(null);
  }

  async function run(confirm: boolean) {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv, fileName, confirm }),
    });

    const body = await res.json();
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "That import could not be run.");
      return;
    }

    if (confirm) {
      setDone(body);
      setPreview(null);
      router.refresh();
    } else {
      setPreview(body);
    }
  }

  const canCommit = preview && preview.errors.length === 0 && preview.created + preview.updated > 0;

  return (
    <main className="main projects-main">
      <p className="crumb">
        <Link href="/admin/sites">← All sites</Link>
      </p>

      <h1 style={{ fontFamily: "Archivo, sans-serif", fontSize: 19, margin: "0 0 4px" }}>
        Import catalog CSV
      </h1>
      <p className="row-meta" style={{ whiteSpace: "normal", marginBottom: 14 }}>
        Matched on <code>domain</code>. Nothing is written until you confirm the preview, and an
        import either lands whole or not at all.
      </p>

      {error && <p className="err">{error}</p>}

      <div className="proj-new">
        <div className="proj-new-grid">
          <label htmlFor="csv-file">CSV file</label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </div>

        <label className="range-lab" htmlFor="csv-text">
          Or paste it
        </label>
        <textarea
          id="csv-text"
          className="csv-box"
          rows={8}
          placeholder={TEMPLATE}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
            setDone(null);
          }}
        />

        <div className="queue-moves" style={{ marginTop: 12 }}>
          <button className="btn" disabled={busy || !csv.trim()} onClick={() => run(false)}>
            {busy ? "Checking…" : "Dry run"}
          </button>
          <button className="btn-ghost btn-sm" disabled={!canCommit || busy} onClick={() => run(true)}>
            {canCommit ? `Import ${preview!.created + preview!.updated} rows` : "Import"}
          </button>
        </div>
      </div>

      {preview && (
        <div className={"import-summary" + (preview.errors.length ? " bad" : "")}>
          <p>
            <strong className="mono">{preview.created}</strong> new ·{" "}
            <strong className="mono">{preview.updated}</strong> updated ·{" "}
            <strong className="mono">{preview.unchanged}</strong> unchanged ·{" "}
            <strong className="mono">{preview.errors.length}</strong> errors
          </p>
          {preview.errors.length > 0 && (
            <>
              <p className="co-warn">
                Nothing will be written while any row has an error. Fix these and run again.
              </p>
              <ul className="import-errors">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    <span className="mono">line {e.line}</span>
                    {e.domain && <span className="mono"> {e.domain}</span>}
                    {e.column && <span className="tag-chan">{e.column}</span>}
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {done && (
        <div className="import-summary">
          <p>
            Imported. <strong className="mono">{done.created}</strong> new,{" "}
            <strong className="mono">{done.updated}</strong> updated,{" "}
            <strong className="mono">{done.unchanged}</strong> unchanged.
          </p>
          <Link className="btn btn-sm" href="/admin/sites">
            Back to sites
          </Link>
        </div>
      )}

      {history.length > 0 && (
        <>
          <h2 style={{ fontFamily: "Archivo, sans-serif", fontSize: 14, margin: "24px 0 10px" }}>
            Recent imports
          </h2>
          <ul className="rows">
            {history.map((h) => (
              <li key={h.id} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                <div className="row-main">
                  <span className="domain">{h.fileName}</span>
                  <p className="row-meta">
                    {h.createdCount} new · {h.updatedCount} updated · {h.unchangedCount} unchanged
                    {h.actor && ` · ${h.actor.email}`}
                  </p>
                </div>
                <span className="metric-lab">
                  {new Date(h.createdAt).toLocaleString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
