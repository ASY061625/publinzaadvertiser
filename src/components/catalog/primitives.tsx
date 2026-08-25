"use client";

import { useState } from "react";

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="tg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="tg-track">
        <span className="tg-dot" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export type Option = { value: string; label: string };

export function CheckList({
  options,
  value,
  onChange,
  searchable = false,
  height = 150,
}: {
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  searchable?: boolean;
  height?: number;
}) {
  const [q, setQ] = useState("");
  const shown =
    searchable && q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div>
      {searchable && (
        <input
          className="mini-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter list"
        />
      )}
      <div className="checklist" style={{ maxHeight: height }}>
        {shown.map((o) => (
          <label key={o.value} className="cl-row">
            <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="empty-mini">Nothing matches “{q}”.</p>}
      </div>
    </div>
  );
}

export function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="fsec">
      <button className="fsec-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span>
        <span className="fsec-right">
          {count > 0 && <em className="pill-num">{count}</em>}
          <span className={"chev" + (open ? " open" : "")}>▾</span>
        </span>
      </button>
      {open && <div className="fsec-body">{children}</div>}
    </section>
  );
}
