"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectRecord } from "@/lib/data/projects";

type Draft = { name: string; targetUrl: string; notes: string };

const EMPTY: Draft = { name: "", targetUrl: "", notes: "" };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ProjectManager({ initial }: { initial: ProjectRecord[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects((await res.json()).projects);
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });

    if (!res.ok) {
      setError((await res.json()).error ?? "Could not create that project.");
      setBusy(false);
      return;
    }
    setDraft(EMPTY);
    await reload();
    setBusy(false);
  }

  async function save(id: string) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(editDraft),
    });

    if (!res.ok) {
      setError(
        res.status === 404
          ? "That project no longer exists."
          : ((await res.json()).error ?? "Could not save that project.")
      );
      setBusy(false);
      return;
    }
    setEditingId(null);
    await reload();
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      setError("Could not delete that project.");
      setBusy(false);
      return;
    }
    setConfirmingId(null);
    await reload();
    setBusy(false);
  }

  return (
    <main className="main projects-main">
      <div className="results-bar">
        <p className="count">
          <strong className="mono">{projects.length}</strong>{" "}
          {projects.length === 1 ? "project" : "projects"}
        </p>
      </div>

      {error && <p className="err">{error}</p>}

      {projects.length === 0 ? (
        <div className="empty">
          <p>No projects yet. Add the site you&apos;re building links for.</p>
        </div>
      ) : (
        <ul className="rows">
          {projects.map((p) => (
            <li key={p.id} className="row proj-row">
              {editingId === p.id ? (
                <div className="proj-edit">
                  <input
                    aria-label="Project name"
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                  />
                  <input
                    aria-label="Target domain"
                    value={editDraft.targetUrl}
                    onChange={(e) => setEditDraft({ ...editDraft, targetUrl: e.target.value })}
                  />
                  <input
                    aria-label="Notes"
                    placeholder="Notes (optional)"
                    value={editDraft.notes}
                    onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                  />
                  <div className="proj-actions">
                    <button className="btn btn-sm" disabled={busy} onClick={() => save(p.id)}>
                      Save
                    </button>
                    <button className="link-btn" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="row-main">
                    <div className="row-title">
                      <span className="domain">{p.name}</span>
                      <span className="tag-chan">{hostOf(p.targetUrl)}</span>
                    </div>
                    {p.notes && <p className="row-meta">{p.notes}</p>}
                  </div>

                  <div className="proj-actions">
                    {confirmingId === p.id ? (
                      <>
                        <span className="confirm-label">Delete this project?</span>
                        <button className="btn-danger" disabled={busy} onClick={() => remove(p.id)}>
                          Delete
                        </button>
                        <button className="link-btn" onClick={() => setConfirmingId(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="link-btn"
                          onClick={() => {
                            setEditingId(p.id);
                            setEditDraft({
                              name: p.name,
                              targetUrl: p.targetUrl,
                              notes: p.notes ?? "",
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button className="link-btn danger" onClick={() => setConfirmingId(p.id)}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="proj-new" onSubmit={create}>
        <h2>Add a project</h2>
        <div className="proj-new-grid">
          <label htmlFor="new-name">Name</label>
          <input
            id="new-name"
            required
            placeholder="Acme Fintech"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />

          <label htmlFor="new-url">Target domain</label>
          <input
            id="new-url"
            required
            placeholder="acme-fintech.com"
            value={draft.targetUrl}
            onChange={(e) => setDraft({ ...draft, targetUrl: e.target.value })}
          />

          <label htmlFor="new-notes">Notes</label>
          <input
            id="new-notes"
            placeholder="Optional"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Add project"}
        </button>
      </form>
    </main>
  );
}
