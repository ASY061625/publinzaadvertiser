import { useState, useMemo } from "react";

/* ------------------------------------------------------------------ data -- */

const SITES = [
  { id: 1, d: "healthlineforward.com", co: "United States", lang: "English", cats: ["Health", "Science"], dr: 75, tr: 890000, p: 760, w: 840, df: true, days: 10, ga: true, gsc: true, sens: [], spam: 1 },
  { id: 2, d: "techradarpulse.com", co: "United States", lang: "English", cats: ["Technology", "Software"], dr: 72, tr: 410000, p: 420, w: 480, df: true, days: 5, ga: true, gsc: true, sens: [], spam: 2 },
  { id: 3, d: "cryptoledgerdaily.com", co: "United States", lang: "English", cats: ["Crypto", "Finance"], dr: 70, tr: 520000, p: 690, w: 770, df: true, days: 6, ga: true, gsc: true, sens: ["crypto", "forex", "casino"], spam: 4 },
  { id: 4, d: "fintechledger.co.uk", co: "United Kingdom", lang: "English", cats: ["Finance", "Business"], dr: 68, tr: 205000, p: 510, w: 575, df: true, days: 7, ga: true, gsc: false, sens: ["forex", "crypto"], spam: 3 },
  { id: 5, d: "gulfventurenews.ae", co: "UAE", lang: "English", cats: ["Business", "Real Estate"], dr: 66, tr: 98000, p: 620, w: 700, df: true, days: 9, ga: false, gsc: true, sens: ["crypto", "forex"], spam: 5 },
  { id: 6, d: "sgwealthbrief.sg", co: "Singapore", lang: "English", cats: ["Finance"], dr: 65, tr: 76000, p: 580, w: 650, df: true, days: 8, ga: true, gsc: true, sens: ["crypto", "forex"], spam: 3 },
  { id: 7, d: "derwirtschaftsblick.de", co: "Germany", lang: "German", cats: ["Business", "Finance"], dr: 64, tr: 132000, p: 390, w: 450, df: true, days: 6, ga: true, gsc: true, sens: [], spam: 2 },
  { id: 8, d: "aussiepropertywire.com.au", co: "Australia", lang: "English", cats: ["Real Estate", "Finance"], dr: 63, tr: 121000, p: 445, w: 510, df: true, days: 6, ga: true, gsc: true, sens: [], spam: 3 },
  { id: 9, d: "thegamerscroll.co.uk", co: "United Kingdom", lang: "English", cats: ["Gaming", "Entertainment"], dr: 62, tr: 340000, p: 380, w: 440, df: true, days: 5, ga: true, gsc: false, sens: ["casino"], spam: 3 },
  { id: 10, d: "lejournaldelauto.fr", co: "France", lang: "French", cats: ["Automotive"], dr: 61, tr: 178000, p: 330, w: 390, df: true, days: 8, ga: true, gsc: true, sens: [], spam: 2 },
  { id: 11, d: "seoulstartupwire.kr", co: "South Korea", lang: "Korean", cats: ["Technology", "Business"], dr: 60, tr: 87000, p: 340, w: 400, df: true, days: 8, ga: true, gsc: true, sens: [], spam: 3 },
  { id: 12, d: "maplehealthdaily.ca", co: "Canada", lang: "English", cats: ["Health"], dr: 59, tr: 167000, p: 310, w: 370, df: true, days: 5, ga: true, gsc: true, sens: ["cbd"], spam: 4 },
  { id: 13, d: "saudecotidiana.com.br", co: "Brazil", lang: "Portuguese", cats: ["Health", "Lifestyle"], dr: 58, tr: 260000, p: 180, w: 220, df: true, days: 5, ga: false, gsc: true, sens: ["cbd"], spam: 5 },
  { id: 14, d: "modaitaliana.it", co: "Italy", lang: "Italian", cats: ["Fashion", "Beauty"], dr: 57, tr: 189000, p: 285, w: 340, df: true, days: 7, ga: true, gsc: true, sens: [], spam: 2 },
  { id: 15, d: "nordiskteknik.se", co: "Sweden", lang: "Swedish", cats: ["Technology", "Energy"], dr: 56, tr: 41000, p: 300, w: 355, df: true, days: 7, ga: true, gsc: true, sens: [], spam: 2 },
  { id: 16, d: "tokyogadgetlab.jp", co: "Japan", lang: "Japanese", cats: ["Technology", "Gaming"], dr: 55, tr: 143000, p: 295, w: 360, df: false, days: 7, ga: false, gsc: false, sens: [], spam: 6 },
  { id: 17, d: "dineromexico.mx", co: "Mexico", lang: "Spanish", cats: ["Finance", "Crypto"], dr: 53, tr: 130000, p: 165, w: 200, df: true, days: 6, ga: true, gsc: true, sens: ["crypto", "forex"], spam: 5 },
  { id: 18, d: "groenwonen.nl", co: "Netherlands", lang: "Dutch", cats: ["Home & Garden", "Energy"], dr: 52, tr: 64000, p: 240, w: 290, df: true, days: 6, ga: true, gsc: true, sens: [], spam: 2 },
  { id: 19, d: "yatraroutes.in", co: "India", lang: "English", cats: ["Travel", "Lifestyle"], dr: 51, tr: 88000, p: 120, w: 150, df: true, days: 4, ga: true, gsc: true, sens: [], spam: 4 },
  { id: 20, d: "sporhaberi.com.tr", co: "Turkey", lang: "Turkish", cats: ["Sports"], dr: 50, tr: 310000, p: 130, w: 165, df: false, days: 4, ga: false, gsc: false, sens: ["casino"], spam: 9 },
  { id: 21, d: "polskatechnologia.pl", co: "Poland", lang: "Polish", cats: ["Technology"], dr: 49, tr: 74000, p: 110, w: 140, df: true, days: 5, ga: true, gsc: false, sens: [], spam: 3 },
  { id: 22, d: "elinversorar.com.ar", co: "Argentina", lang: "Spanish", cats: ["Finance", "Crypto"], dr: 48, tr: 68000, p: 115, w: 145, df: true, days: 5, ga: true, gsc: false, sens: ["crypto", "forex"], spam: 6 },
  { id: 23, d: "ceskyhrac.cz", co: "Czechia", lang: "Czech", cats: ["Gaming", "Entertainment"], dr: 47, tr: 128000, p: 125, w: 155, df: true, days: 5, ga: true, gsc: true, sens: ["casino"], spam: 6 },
  { id: 24, d: "cocinaespanola.es", co: "Spain", lang: "Spanish", cats: ["Food", "Lifestyle"], dr: 47, tr: 95000, p: 140, w: 175, df: true, days: 6, ga: true, gsc: false, sens: [], spam: 3 },
  { id: 25, d: "kabarteknologi.id", co: "Indonesia", lang: "Indonesian", cats: ["Technology"], dr: 46, tr: 220000, p: 105, w: 135, df: true, days: 4, ga: true, gsc: false, sens: ["casino"], spam: 7 },
  { id: 26, d: "capetownliving.co.za", co: "South Africa", lang: "English", cats: ["Lifestyle", "Travel"], dr: 45, tr: 52000, p: 135, w: 170, df: true, days: 5, ga: true, gsc: true, sens: [], spam: 4 },
  { id: 27, d: "kyivmarketpost.ua", co: "Ukraine", lang: "Ukrainian", cats: ["Business", "Marketing"], dr: 44, tr: 39000, p: 85, w: 110, df: true, days: 4, ga: true, gsc: true, sens: [], spam: 4 },
  { id: 28, d: "bogotalegal.co", co: "Colombia", lang: "Spanish", cats: ["Legal", "Business"], dr: 44, tr: 33000, p: 105, w: 135, df: true, days: 6, ga: true, gsc: false, sens: [], spam: 4 },
  { id: 29, d: "vietnamtravelgo.vn", co: "Vietnam", lang: "Vietnamese", cats: ["Travel"], dr: 43, tr: 112000, p: 75, w: 100, df: true, days: 3, ga: false, gsc: false, sens: [], spam: 6 },
  { id: 30, d: "manilacareerhub.ph", co: "Philippines", lang: "English", cats: ["Education", "HR"], dr: 42, tr: 97000, p: 70, w: 95, df: true, days: 4, ga: false, gsc: false, sens: [], spam: 5 },
  { id: 31, d: "naijabusinesspulse.ng", co: "Nigeria", lang: "English", cats: ["Business", "Finance"], dr: 41, tr: 156000, p: 95, w: 125, df: true, days: 3, ga: false, gsc: false, sens: ["crypto", "forex", "casino"], spam: 8 },
  { id: 32, d: "masralyoumtech.eg", co: "Egypt", lang: "Arabic", cats: ["Technology", "Science"], dr: 40, tr: 145000, p: 80, w: 105, df: true, days: 3, ga: false, gsc: false, sens: ["casino", "forex"], spam: 9 },
  { id: 33, d: "bangkokparenting.th", co: "Thailand", lang: "Thai", cats: ["Parenting", "Health"], dr: 39, tr: 58000, p: 72, w: 95, df: true, days: 5, ga: true, gsc: false, sens: [], spam: 4 },
  { id: 34, d: "mypetkl.my", co: "Malaysia", lang: "English", cats: ["Pets", "Lifestyle"], dr: 38, tr: 46000, p: 65, w: 90, df: true, days: 4, ga: false, gsc: false, sens: [], spam: 5 },
  { id: 35, d: "nairobiagritoday.ke", co: "Kenya", lang: "English", cats: ["Agriculture", "Science"], dr: 37, tr: 44000, p: 60, w: 82, df: true, days: 4, ga: false, gsc: false, sens: [], spam: 6 },
];

const SENSITIVE = ["casino", "crypto", "forex", "cbd", "adult", "dating"];
const uniq = (a) => [...new Set(a)].sort();
const ALL_CATS = uniq(SITES.flatMap((s) => s.cats));
const ALL_COUNTRIES = uniq(SITES.map((s) => s.co));
const ALL_LANGS = uniq(SITES.map((s) => s.lang));
const MAX_TR = Math.max(...SITES.map((s) => s.tr));

const fmtTraffic = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);
const money = (n) => "$" + n.toLocaleString("en-US");

const drBand = (dr) => (dr >= 70 ? 3 : dr >= 55 ? 2 : dr >= 40 ? 1 : 0);
const BAND_LABELS = ["<40", "40–54", "55–69", "70+"];

/* ------------------------------------------------------------- primitives -- */

function Toggle({ checked, onChange, label }) {
  return (
    <label className="tg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="tg-track"><span className="tg-dot" /></span>
      <span>{label}</span>
    </label>
  );
}

function CheckList({ options, value, onChange, searchable = false, height = 150 }) {
  const [q, setQ] = useState("");
  const shown = searchable && q
    ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase()))
    : options;
  const toggle = (o) =>
    onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
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
          <label key={o} className="cl-row">
            <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} />
            <span>{o}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="empty-mini">Nothing matches “{q}”.</p>}
      </div>
    </div>
  );
}

function Section({ title, count, children, defaultOpen = true }) {
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

/* -------------------------------------------------------------------- app -- */

const EMPTY = {
  q: "",
  cats: [],
  countries: [],
  langs: [],
  drMin: 0,
  drMax: 100,
  trMin: 0,
  pMin: "",
  pMax: "",
  dofollowOnly: false,
  gaOnly: false,
  accepts: [],
  maxDays: 0,
};

export default function Catalog() {
  const [f, setF] = useState(EMPTY);
  const [sort, setSort] = useState("dr");
  const [picked, setPicked] = useState([]);
  const [railOpen, setRailOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);

  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));

  const results = useMemo(() => {
    const out = SITES.filter((s) => {
      if (f.q && !s.d.toLowerCase().includes(f.q.toLowerCase())) return false;
      if (f.cats.length && !s.cats.some((c) => f.cats.includes(c))) return false;
      if (f.countries.length && !f.countries.includes(s.co)) return false;
      if (f.langs.length && !f.langs.includes(s.lang)) return false;
      if (s.dr < f.drMin || s.dr > f.drMax) return false;
      if (s.tr < f.trMin) return false;
      if (f.pMin !== "" && s.p < Number(f.pMin)) return false;
      if (f.pMax !== "" && s.p > Number(f.pMax)) return false;
      if (f.dofollowOnly && !s.df) return false;
      if (f.gaOnly && !s.ga) return false;
      if (f.maxDays && s.days > f.maxDays) return false;
      if (f.accepts.length && !f.accepts.every((a) => s.sens.includes(a))) return false;
      return true;
    });
    const by = {
      dr: (a, b) => b.dr - a.dr,
      traffic: (a, b) => b.tr - a.tr,
      priceAsc: (a, b) => a.p - b.p,
      priceDesc: (a, b) => b.p - a.p,
      fastest: (a, b) => a.days - b.days,
    }[sort];
    return out.sort(by);
  }, [f, sort]);

  const activeCount =
    f.cats.length + f.countries.length + f.langs.length + f.accepts.length +
    (f.q ? 1 : 0) + (f.drMin > 0 || f.drMax < 100 ? 1 : 0) + (f.trMin ? 1 : 0) +
    (f.pMin !== "" || f.pMax !== "" ? 1 : 0) + (f.dofollowOnly ? 1 : 0) +
    (f.gaOnly ? 1 : 0) + (f.maxDays ? 1 : 0);

  const chosen = SITES.filter((s) => picked.includes(s.id));
  const subtotal = chosen.reduce((n, s) => n + s.p, 0);
  const avgDr = chosen.length ? Math.round(chosen.reduce((n, s) => n + s.dr, 0) / chosen.length) : 0;
  const bands = [0, 0, 0, 0];
  chosen.forEach((s) => bands[drBand(s.dr)]++);
  const countryCounts = {};
  chosen.forEach((s) => (countryCounts[s.co] = (countryCounts[s.co] || 0) + 1));
  const topCountry = Object.entries(countryCounts).sort((a, b) => b[1] - a[1])[0];
  const concentrated = chosen.length >= 5 && topCountry && topCountry[1] / chosen.length > 0.4;

  const toggleSite = (id) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="app">
      <style>{CSS}</style>

      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span className="wordmark">OUTPOST</span>
        </div>
        <div className="top-right">
          <div className="proj">
            <label htmlFor="proj">Project</label>
            <select id="proj" defaultValue="acme">
              <option value="acme">acme-fintech.com</option>
              <option value="glide">glidewear.co</option>
            </select>
          </div>
          <div className="bal">
            <span className="bal-label">Balance</span>
            <span className="bal-num">$4,280</span>
          </div>
        </div>
      </header>

      <div className="shell">
        <button className="rail-toggle" onClick={() => setRailOpen(!railOpen)}>
          {railOpen ? "Hide filters" : `Filters${activeCount ? ` (${activeCount})` : ""}`}
        </button>

        <aside className={"rail" + (railOpen ? " open" : "")}>
          <div className="rail-head">
            <h2>Filters</h2>
            {activeCount > 0 && (
              <button className="link-btn" onClick={() => setF(EMPTY)}>Reset all</button>
            )}
          </div>

          <input
            className="search"
            value={f.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search domain"
          />

          <Section title="Topic" count={f.cats.length}>
            <CheckList options={ALL_CATS} value={f.cats} onChange={(v) => set("cats", v)} searchable height={168} />
          </Section>

          <Section title="Country" count={f.countries.length} defaultOpen={false}>
            <CheckList options={ALL_COUNTRIES} value={f.countries} onChange={(v) => set("countries", v)} searchable height={168} />
          </Section>

          <Section title="Language" count={f.langs.length} defaultOpen={false}>
            <CheckList options={ALL_LANGS} value={f.langs} onChange={(v) => set("langs", v)} height={168} />
          </Section>

          <Section title="Domain rating" count={f.drMin > 0 || f.drMax < 100 ? 1 : 0}>
            <div className="range-vals">
              <span className="mono">{f.drMin}</span>
              <span className="range-dash" />
              <span className="mono">{f.drMax}</span>
            </div>
            <label className="range-lab">Minimum</label>
            <input type="range" min="0" max="100" value={f.drMin}
              onChange={(e) => set("drMin", Math.min(Number(e.target.value), f.drMax))} />
            <label className="range-lab">Maximum</label>
            <input type="range" min="0" max="100" value={f.drMax}
              onChange={(e) => set("drMax", Math.max(Number(e.target.value), f.drMin))} />
          </Section>

          <Section title="Traffic & price" count={(f.trMin ? 1 : 0) + (f.pMin !== "" || f.pMax !== "" ? 1 : 0)}>
            <label className="range-lab">Monthly organic traffic</label>
            <select value={f.trMin} onChange={(e) => set("trMin", Number(e.target.value))}>
              <option value={0}>Any</option>
              <option value={10000}>10K and above</option>
              <option value={50000}>50K and above</option>
              <option value={100000}>100K and above</option>
              <option value={250000}>250K and above</option>
            </select>
            <label className="range-lab">Price per placement</label>
            <div className="pair">
              <input type="number" placeholder="Min" value={f.pMin} onChange={(e) => set("pMin", e.target.value)} />
              <input type="number" placeholder="Max" value={f.pMax} onChange={(e) => set("pMax", e.target.value)} />
            </div>
          </Section>

          <Section title="Placement rules" count={(f.dofollowOnly ? 1 : 0) + (f.gaOnly ? 1 : 0) + (f.maxDays ? 1 : 0) + f.accepts.length}>
            <Toggle checked={f.dofollowOnly} onChange={(v) => set("dofollowOnly", v)} label="Dofollow links only" />
            <Toggle checked={f.gaOnly} onChange={(v) => set("gaOnly", v)} label="Analytics-verified traffic" />
            <label className="range-lab">Publishes within</label>
            <select value={f.maxDays} onChange={(e) => set("maxDays", Number(e.target.value))}>
              <option value={0}>Any turnaround</option>
              <option value={4}>4 days</option>
              <option value={7}>7 days</option>
              <option value={10}>10 days</option>
            </select>
            <label className="range-lab">Accepts restricted topics</label>
            <div className="chips">
              {SENSITIVE.map((s) => (
                <button
                  key={s}
                  className={"chip" + (f.accepts.includes(s) ? " on" : "")}
                  onClick={() =>
                    set("accepts", f.accepts.includes(s) ? f.accepts.filter((x) => x !== s) : [...f.accepts, s])
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </Section>
        </aside>

        <main className="main">
          <div className="results-bar">
            <p className="count">
              <strong className="mono">{results.length}</strong> of {SITES.length} sites
            </p>
            <div className="sort">
              <label htmlFor="sort">Sort</label>
              <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="dr">Domain rating</option>
                <option value="traffic">Traffic</option>
                <option value="priceAsc">Price, low to high</option>
                <option value="priceDesc">Price, high to low</option>
                <option value="fastest">Fastest turnaround</option>
              </select>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="empty">
              <p>No sites match these filters.</p>
              <button className="btn-ghost" onClick={() => setF(EMPTY)}>Clear filters</button>
            </div>
          ) : (
            <ul className="rows">
              {results.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <li key={s.id} className={"row" + (on ? " on" : "")}>
                    <div className="row-main">
                      <div className="row-title">
                        <span className="domain">{s.d}</span>
                        {s.ga && <span className="verified" title="Traffic verified via Google Analytics">verified</span>}
                        {!s.df && <span className="tag-nf">nofollow</span>}
                        {s.spam >= 7 && <span className="tag-risk">high spam score</span>}
                      </div>
                      <p className="row-meta">
                        {s.co} · {s.lang} · {s.cats.join(", ")} · publishes in {s.days} days
                        {s.sens.length > 0 && <span className="meta-sens"> · accepts {s.sens.join(", ")}</span>}
                      </p>
                    </div>

                    <div className="metric">
                      <span className={"dr b" + drBand(s.dr)}>{s.dr}</span>
                      <span className="metric-lab">DR</span>
                    </div>

                    <div className="metric wide">
                      <span className="mono traffic">{fmtTraffic(s.tr)}</span>
                      <span className="bar">
                        <span
                          className="bar-fill"
                          style={{ width: (Math.log10(s.tr) / Math.log10(MAX_TR)) * 100 + "%" }}
                        />
                      </span>
                      <span className="metric-lab">Monthly organic</span>
                    </div>

                    <div className="price">
                      <span className="mono price-num">{money(s.p)}</span>
                      <span className="metric-lab">+{money(s.w - s.p)} with writing</span>
                    </div>

                    <button className={"btn-add" + (on ? " on" : "")} onClick={() => toggleSite(s.id)}>
                      {on ? "Added" : "Add"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="tray-space" />
        </main>
      </div>

      {chosen.length > 0 && (
        <div className="tray">
          <div className="tray-in">
            <div className="tray-stat">
              <span className="tray-num mono">{chosen.length}</span>
              <span className="tray-lab">sites</span>
            </div>
            <div className="tray-stat">
              <span className="tray-num mono">{money(subtotal)}</span>
              <span className="tray-lab">subtotal</span>
            </div>
            <div className="tray-stat">
              <span className="tray-num mono">{avgDr}</span>
              <span className="tray-lab">avg DR</span>
            </div>
            <div className="hist" aria-label="Domain rating spread of your selection">
              {bands.map((n, i) => (
                <div key={i} className="hist-col">
                  <div className="hist-bar" style={{ height: Math.max(3, (n / chosen.length) * 34) }} />
                  <span className="hist-lab">{BAND_LABELS[i]}</span>
                </div>
              ))}
            </div>
            <div className="tray-stat">
              <span className="tray-num mono">{Object.keys(countryCounts).length}</span>
              <span className="tray-lab">countries</span>
            </div>
            {concentrated && (
              <p className="warn">
                {Math.round((topCountry[1] / chosen.length) * 100)}% of this batch is {topCountry[0]}. Spread it wider unless that market is the target.
              </p>
            )}
            <div className="tray-actions">
              <button className="btn-ghost" onClick={() => setPicked([])}>Clear</button>
              <button className="btn" onClick={() => setCheckout(true)}>Review order</button>
            </div>
          </div>
        </div>
      )}

      {checkout && <Checkout sites={chosen} onClose={() => setCheckout(false)} />}
    </div>
  );
}

/* --------------------------------------------------------------- checkout -- */

function Checkout({ sites, onClose }) {
  const [rows, setRows] = useState(
    () => Object.fromEntries(sites.map((s) => [s.id, { url: "", anchor: "", write: false }]))
  );
  const [done, setDone] = useState(false);

  const total = sites.reduce((n, s) => n + (rows[s.id]?.write ? s.w : s.p), 0);
  const ready = sites.every((s) => rows[s.id].url.trim() && rows[s.id].anchor.trim());
  const upd = (id, k, v) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: v } }));

  return (
    <div className="veil" role="dialog" aria-modal="true">
      <div className="sheet">
        <header className="sheet-head">
          <h2>{done ? "Order placed" : `Review ${sites.length} placements`}</h2>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {done ? (
          <div className="sheet-done">
            <p className="ref mono">ORD-2026-00412</p>
            <p>
              Funds are held until each link is live and verified. You'll see status per placement
              in Orders, and a re-crawl runs monthly for the full guarantee period.
            </p>
            <button className="btn" onClick={onClose}>Back to catalog</button>
          </div>
        ) : (
          <>
            <div className="sheet-body">
              {sites.map((s) => (
                <div key={s.id} className="co-row">
                  <div className="co-site">
                    <span className="domain">{s.d}</span>
                    <span className="co-meta">DR {s.dr} · {s.co}</span>
                  </div>
                  <input
                    placeholder="Target URL"
                    value={rows[s.id].url}
                    onChange={(e) => upd(s.id, "url", e.target.value)}
                  />
                  <input
                    placeholder="Anchor text"
                    value={rows[s.id].anchor}
                    onChange={(e) => upd(s.id, "anchor", e.target.value)}
                  />
                  <label className="co-write">
                    <input
                      type="checkbox"
                      checked={rows[s.id].write}
                      onChange={(e) => upd(s.id, "write", e.target.checked)}
                    />
                    <span>We write it (+{money(s.w - s.p)})</span>
                  </label>
                  <span className="mono co-price">{money(rows[s.id].write ? s.w : s.p)}</span>
                </div>
              ))}
            </div>
            <footer className="sheet-foot">
              <div>
                <span className="tray-lab">Total</span>
                <span className="mono foot-total">{money(total)}</span>
              </div>
              <button className="btn" disabled={!ready} onClick={() => setDone(true)}>
                {ready ? "Place order" : "Add a URL and anchor for each site"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- css -- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.app {
  --ink:#16181d; --ink2:#3a4049; --mut:#697080; --rule:#e3e6eb;
  --canvas:#f4f5f8; --surf:#ffffff; --acc:#2f4bd8; --acc-soft:#e9edfc;
  --teal:#0e8a6e; --amber:#8f5a06; --risk:#a4322a;
  font-family:'IBM Plex Sans',system-ui,sans-serif;
  color:var(--ink); background:var(--canvas);
  min-height:100vh; font-size:14px; line-height:1.45;
}
.app *{box-sizing:border-box;}
.app button,.app input,.app select{font:inherit;color:inherit;}
.app :focus-visible{outline:2px solid var(--acc);outline-offset:2px;}
.mono{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;}

/* top bar */
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:12px 20px;background:var(--surf);border-bottom:1px solid var(--rule);
  position:sticky;top:0;z-index:30;}
.brand{display:flex;align-items:center;gap:9px;}
.mark{width:13px;height:13px;background:var(--acc);
  clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);}
.wordmark{font-family:'Archivo',sans-serif;font-weight:700;letter-spacing:.14em;font-size:14px;}
.top-right{display:flex;align-items:center;gap:20px;}
.proj{display:flex;align-items:center;gap:7px;}
.proj label{color:var(--mut);font-size:12px;}
.top select{border:1px solid var(--rule);background:var(--surf);border-radius:5px;padding:5px 8px;font-size:13px;}
.bal{display:flex;flex-direction:column;align-items:flex-end;line-height:1.1;}
.bal-label{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);}
.bal-num{font-family:'IBM Plex Mono',monospace;font-weight:500;}

/* shell */
.shell{display:flex;align-items:flex-start;gap:0;max-width:1240px;margin:0 auto;}
.rail{width:272px;flex:0 0 272px;padding:18px 16px 40px;border-right:1px solid var(--rule);
  background:var(--surf);position:sticky;top:54px;max-height:calc(100vh - 54px);overflow-y:auto;}
.rail-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px;}
.rail-head h2{font-family:'Archivo',sans-serif;font-size:12px;letter-spacing:.1em;
  text-transform:uppercase;margin:0;color:var(--mut);}
.link-btn{background:none;border:0;color:var(--acc);cursor:pointer;font-size:12px;padding:0;}
.rail-toggle{display:none;}

.search,.mini-search{width:100%;border:1px solid var(--rule);border-radius:6px;
  padding:8px 10px;background:var(--surf);}
.search{margin-bottom:6px;}
.mini-search{margin-bottom:6px;font-size:12.5px;padding:6px 8px;}

.fsec{border-top:1px solid var(--rule);}
.fsec-head{width:100%;display:flex;align-items:center;justify-content:space-between;
  background:none;border:0;padding:11px 0;cursor:pointer;font-weight:500;}
.fsec-right{display:flex;align-items:center;gap:7px;}
.pill-num{font-style:normal;font-size:11px;background:var(--acc);color:#fff;
  border-radius:9px;padding:1px 6px;font-family:'IBM Plex Mono',monospace;}
.chev{color:var(--mut);font-size:11px;transition:transform .15s;}
.chev.open{transform:rotate(180deg);}
.fsec-body{padding-bottom:14px;}

.checklist{overflow-y:auto;border:1px solid var(--rule);border-radius:6px;padding:4px;}
.cl-row{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:13px;}
.cl-row:hover{background:var(--canvas);}
.empty-mini{color:var(--mut);font-size:12px;padding:6px;margin:0;}

.range-lab{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--mut);margin:12px 0 5px;}
.range-vals{display:flex;align-items:center;gap:8px;font-weight:500;}
.range-dash{flex:1;height:1px;background:var(--rule);}
.rail input[type=range]{width:100%;accent-color:var(--acc);}
.rail select{width:100%;border:1px solid var(--rule);border-radius:6px;padding:7px 8px;background:var(--surf);}
.pair{display:flex;gap:8px;}
.pair input{width:100%;border:1px solid var(--rule);border-radius:6px;padding:7px 8px;}

.tg{display:flex;align-items:center;gap:9px;padding:6px 0;cursor:pointer;font-size:13px;}
.tg input{position:absolute;opacity:0;width:0;}
.tg-track{width:30px;height:17px;border-radius:9px;background:#cdd2da;position:relative;transition:background .15s;flex:0 0 auto;}
.tg-dot{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:left .15s;}
.tg input:checked + .tg-track{background:var(--acc);}
.tg input:checked + .tg-track .tg-dot{left:15px;}

.chips{display:flex;flex-wrap:wrap;gap:5px;}
.chip{border:1px solid var(--rule);background:var(--surf);border-radius:12px;
  padding:3px 10px;font-size:12px;cursor:pointer;color:var(--ink2);}
.chip.on{background:var(--acc);border-color:var(--acc);color:#fff;}

/* results */
.main{flex:1;min-width:0;padding:18px 20px 0;}
.results-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.count{margin:0;color:var(--mut);}
.count strong{color:var(--ink);font-size:15px;}
.sort{display:flex;align-items:center;gap:7px;}
.sort label{color:var(--mut);font-size:12px;}
.sort select{border:1px solid var(--rule);border-radius:6px;padding:6px 8px;background:var(--surf);}

.rows{list-style:none;margin:0;padding:0;background:var(--surf);
  border:1px solid var(--rule);border-radius:8px;overflow:hidden;}
.row{display:grid;grid-template-columns:1fr 52px 118px 106px 76px;gap:14px;align-items:center;
  padding:13px 16px;border-bottom:1px solid var(--rule);}
.row:last-child{border-bottom:0;}
.row:hover{background:#fafbfd;}
.row.on{background:var(--acc-soft);}
.row-main{min-width:0;}
.row-title{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.domain{font-weight:600;font-size:14.5px;}
.verified{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--teal);
  border:1px solid var(--teal);border-radius:3px;padding:0 4px;}
.tag-nf{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--amber);
  border:1px solid var(--amber);border-radius:3px;padding:0 4px;}
.tag-risk{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--risk);
  border:1px solid var(--risk);border-radius:3px;padding:0 4px;}
.row-meta{margin:3px 0 0;color:var(--mut);font-size:12.5px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.meta-sens{color:var(--amber);}

.metric{display:flex;flex-direction:column;gap:2px;}
.metric-lab{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);}
.dr{font-family:'Archivo',sans-serif;font-weight:600;font-size:17px;line-height:1;}
.dr.b0{color:#8a919d;} .dr.b1{color:var(--ink2);} .dr.b2{color:var(--acc);} .dr.b3{color:#1a2f9c;}
.traffic{font-size:14px;}
.bar{display:block;height:3px;background:var(--rule);border-radius:2px;overflow:hidden;margin:3px 0 1px;}
.bar-fill{display:block;height:100%;background:var(--ink2);}
.price{display:flex;flex-direction:column;gap:2px;text-align:right;}
.price-num{font-size:15px;font-weight:500;}
.price .metric-lab{text-transform:none;letter-spacing:0;font-size:11px;}

.btn-add{border:1px solid var(--acc);background:var(--surf);color:var(--acc);
  border-radius:6px;padding:6px 0;cursor:pointer;font-weight:500;font-size:13px;}
.btn-add:hover{background:var(--acc-soft);}
.btn-add.on{background:var(--acc);color:#fff;}

.empty{background:var(--surf);border:1px solid var(--rule);border-radius:8px;
  padding:48px;text-align:center;color:var(--mut);}
.empty p{margin:0 0 12px;}
.tray-space{height:110px;}

/* tray */
.tray{position:fixed;left:0;right:0;bottom:0;z-index:40;background:var(--ink);color:#fff;}
.tray-in{max-width:1240px;margin:0 auto;padding:12px 20px;
  display:flex;align-items:center;gap:26px;flex-wrap:wrap;}
.tray-stat{display:flex;flex-direction:column;line-height:1.15;}
.tray-num{font-size:17px;font-weight:500;}
.tray-lab{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#9aa2b1;}
.hist{display:flex;align-items:flex-end;gap:4px;height:46px;}
.hist-col{display:flex;flex-direction:column;align-items:center;gap:3px;justify-content:flex-end;}
.hist-bar{width:26px;background:#5b74e8;border-radius:2px 2px 0 0;}
.hist-lab{font-size:9px;color:#9aa2b1;font-family:'IBM Plex Mono',monospace;}
.warn{margin:0;max-width:290px;font-size:12px;color:#f0c98a;border-left:2px solid #f0c98a;padding-left:10px;}
.tray-actions{margin-left:auto;display:flex;gap:8px;}
.btn{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:9px 18px;
  cursor:pointer;font-weight:500;}
.btn:disabled{background:#4b5261;cursor:not-allowed;}
.btn-ghost{background:none;color:inherit;border:1px solid currentColor;border-radius:6px;
  padding:9px 16px;cursor:pointer;opacity:.75;}
.btn-ghost:hover{opacity:1;}

/* checkout */
.veil{position:fixed;inset:0;background:rgba(22,24,29,.5);z-index:60;
  display:flex;align-items:center;justify-content:center;padding:20px;}
.sheet{background:var(--surf);border-radius:10px;width:100%;max-width:860px;
  max-height:88vh;display:flex;flex-direction:column;overflow:hidden;}
.sheet-head{display:flex;align-items:center;justify-content:space-between;
  padding:16px 20px;border-bottom:1px solid var(--rule);}
.sheet-head h2{font-family:'Archivo',sans-serif;font-size:16px;margin:0;}
.x{background:none;border:0;cursor:pointer;color:var(--mut);font-size:15px;}
.sheet-body{overflow-y:auto;padding:6px 20px;}
.co-row{display:grid;grid-template-columns:160px 1fr 150px 150px 66px;gap:10px;
  align-items:center;padding:11px 0;border-bottom:1px solid var(--rule);}
.co-row input[type=text],.co-row input:not([type]){width:100%;}
.co-row input:not([type=checkbox]){border:1px solid var(--rule);border-radius:6px;padding:7px 9px;}
.co-site{display:flex;flex-direction:column;min-width:0;}
.co-site .domain{font-size:13.5px;overflow:hidden;text-overflow:ellipsis;}
.co-meta{font-size:11.5px;color:var(--mut);}
.co-write{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink2);cursor:pointer;}
.co-price{text-align:right;font-weight:500;}
.sheet-foot{display:flex;align-items:center;justify-content:space-between;
  padding:14px 20px;border-top:1px solid var(--rule);background:var(--canvas);}
.sheet-foot > div{display:flex;flex-direction:column;line-height:1.15;}
.sheet-foot .tray-lab{color:var(--mut);}
.foot-total{font-size:20px;font-weight:500;}
.sheet-done{padding:34px 24px;text-align:center;color:var(--ink2);}
.sheet-done p{max-width:440px;margin:0 auto 18px;}
.ref{font-size:19px;color:var(--acc);letter-spacing:.04em;}

@media (max-width:900px){
  .shell{flex-direction:column;}
  .rail-toggle{display:block;margin:14px 20px 0;border:1px solid var(--rule);
    background:var(--surf);border-radius:6px;padding:9px 14px;cursor:pointer;font-weight:500;}
  .rail{position:static;width:100%;flex:none;max-height:none;border-right:0;
    border-bottom:1px solid var(--rule);display:none;}
  .rail.open{display:block;}
  .main{width:100%;padding:14px 16px 0;}
  .row{grid-template-columns:1fr auto;gap:8px 14px;}
  .row-main{grid-column:1 / -1;}
  .metric.wide{display:none;}
  .price{text-align:left;}
  .btn-add{padding:7px 16px;}
  .tray-in{gap:16px;}
  .hist{display:none;}
  .warn{max-width:none;flex-basis:100%;}
  .tray-actions{margin-left:0;flex-basis:100%;}
  .tray-actions .btn{flex:1;}
  .co-row{grid-template-columns:1fr;gap:7px;}
  .co-price{text-align:left;}
}
@media (prefers-reduced-motion:reduce){.app *{transition:none !important;}}
`;
