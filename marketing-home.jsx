import { useState } from "react";

/* Placeholder catalog rows for the preview strip. Wire these to a real
   /api/public/sites endpoint that returns masked domains. */
const PREVIEW = [
  { d: "techrada***.com", co: "United States", cat: "Technology", dr: 72, tr: "410K", p: 420 },
  { d: "derwirtschafts***.de", co: "Germany", cat: "Business", dr: 64, tr: "132K", p: 390 },
  { d: "yatra***.in", co: "India", cat: "Travel", dr: 51, tr: "88K", p: 120 },
  { d: "modaital***.it", co: "Italy", cat: "Fashion", dr: 57, tr: "189K", p: 285 },
];

const REJECTS = [
  ["Traffic collapse", "Organic traffic down more than 60% over twelve months — almost always a penalty."],
  ["Dead sponsored archives", "If their paid posts from two years ago are gone, yours will be too."],
  ["Link farm output", "Twenty recent posts spanning crypto, dentistry and casinos is not a publication."],
  ["Network fingerprints", "Shared analytics IDs, identical templates, same registration date across domains."],
  ["Manufactured authority", "High domain rating built from a handful of low-quality sources."],
  ["Junk traffic", "Ranking for terms nobody searches with intent — the number looks fine, the visitors aren't real."],
];

const STEPS = [
  ["Filter the catalog", "Search by country, language, topic, authority, traffic and price. Every metric is refreshed on a schedule and dated, so you know how old it is."],
  ["Add your details", "Target URL and anchor text per placement. Send us your article or have our writers produce it."],
  ["We handle placement", "Our team works directly with the publisher. You watch each placement move through to publication on your order page."],
  ["We keep watching", "Every link is checked for the full guarantee window. If one disappears, we replace it or refund it."],
];

const FAQS = [
  ["How many sites are in the catalog?", "Fewer than the large marketplaces, deliberately. We reject most sites we review. Every listing has been checked by a person against a published standard, and we'd rather show you sixty sites we'd stake our name on than six thousand we haven't looked at."],
  ["Are the links dofollow?", "Each listing states the link type as the publisher actually implements it, verified after publication. Where a publisher marks sponsored content, we say so rather than claiming otherwise."],
  ["What happens if a link is removed?", "Every placement is monitored for the full guarantee period. If a link goes missing we confirm it across several checks, then either secure a replacement placement or refund that placement in full."],
  ["Do you have a subscription?", "No. You pay per placement, at the price shown in the catalog. No minimum, no retainer, no monthly fee."],
  ["Can I supply my own content?", "Yes, and it's cheaper. If you'd rather not, our writers produce it to the publisher's guidelines for the fee shown next to each site."],
  ["Do you accept restricted topics?", "Some publishers accept gambling, crypto, forex or CBD content. The catalog filters for exactly which. Many don't, and we don't pressure them to."],
];

export default function Home() {
  const [open, setOpen] = useState(null);

  return (
    <div className="site">
      <style>{CSS}</style>

      <header className="nav">
        <a className="brand" href="/">
          <span className="mark" aria-hidden="true" />
          <span className="wordmark">OUTPOST</span>
        </a>
        <nav className="nav-links">
          <a href="/catalog">Catalog</a>
          <a href="/how-it-works">How it works</a>
          <a href="/vetting">Vetting</a>
          <a href="/pricing">Pricing</a>
          <a href="/blog">Blog</a>
        </nav>
        <div className="nav-cta">
          <a className="txt-link" href="https://app.example.com/login">Log in</a>
          <a className="btn" href="/catalog">Browse catalog</a>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">Content placement · 33 countries</p>
        <h1>
          Every site in this catalog was checked by a person.
          <span className="h1-mut"> Most don't make it in.</span>
        </h1>
        <p className="lede">
          Guest posts and digital PR placements on publications we've vetted against a
          published standard — traffic history, link profile, and whether their paid
          content from two years ago is still online. Prices shown up front.
        </p>
        <form className="hero-search" onSubmit={(e) => e.preventDefault()}>
          <input placeholder="Search by niche, country or domain" aria-label="Search the catalog" />
          <button className="btn" type="submit">Search</button>
        </form>
        <p className="hero-note">No account needed to browse. No subscription, ever.</p>
      </section>

      <section className="stats">
        {[["62", "vetted sites"], ["33", "countries"], ["24", "niches"], ["100%", "links monitored"]].map(([n, l]) => (
          <div key={l} className="stat">
            <span className="stat-n mono">{n}</span>
            <span className="stat-l">{l}</span>
          </div>
        ))}
      </section>

      <section className="band">
        <div className="band-head">
          <h2>What gets a site rejected</h2>
          <p>
            Our standard is published in full because we think you should be able to
            check our work. These are the six reasons we turn sites away most often.
          </p>
        </div>
        <ul className="rejects">
          {REJECTS.map(([t, d]) => (
            <li key={t}>
              <span className="x" aria-hidden="true">✕</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ul>
        <a className="txt-link arrow" href="/vetting">Read the full vetting standard</a>
      </section>

      <section className="band alt">
        <div className="band-head">
          <h2>A look at the catalog</h2>
          <p>Full domains, contact details and ordering unlock when you create a free account.</p>
        </div>
        <div className="preview">
          <div className="pv-head">
            <span>Site</span><span>DR</span><span>Traffic</span><span>Price</span>
          </div>
          {PREVIEW.map((s) => (
            <div key={s.d} className="pv-row">
              <div className="pv-site">
                <span className="pv-dom">{s.d}</span>
                <span className="pv-meta">{s.co} · {s.cat}</span>
              </div>
              <span className="mono pv-dr">{s.dr}</span>
              <span className="mono">{s.tr}</span>
              <span className="mono pv-price">${s.p}</span>
            </div>
          ))}
        </div>
        <a className="txt-link arrow" href="/catalog">Browse all 62 sites</a>
      </section>

      <section className="band">
        <div className="band-head">
          <h2>How it works</h2>
        </div>
        <ol className="steps">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="step-n mono">{String(i + 1).padStart(2, "0")}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="guarantee">
        <div className="g-in">
          <h2>We keep checking after you've paid</h2>
          <p>
            Publishers sometimes quietly delete sponsored posts, strip links, or switch
            them to nofollow months later. We check every placement we've sold on a
            schedule for the full guarantee period, and we can tell the difference
            between a removed link and a publisher blocking our crawler.
          </p>
          <p>
            If a link is genuinely gone, we confirm it across several checks over several
            days, then secure a replacement or refund that placement. The exact terms are
            written out, not buried.
          </p>
          <a className="btn light" href="/guarantee">Read the guarantee</a>
        </div>
      </section>

      <section className="band alt">
        <div className="band-head">
          <h2>Who this is for</h2>
        </div>
        <div className="cards">
          {[
            ["Agencies", "Run placements for several clients from one account, with each project kept separate. Per-client reporting and invoicing that your finance team won't query."],
            ["SaaS and startups", "Build authority in the markets you actually sell in. Filter by country and language so links come from publications your buyers read."],
            ["In-house marketing", "Prices visible before you commit, proper invoices with tax details, and a paper trail for every placement when procurement asks."],
          ].map(([t, d]) => (
            <article key={t} className="card">
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="band">
        <div className="band-head">
          <h2>Questions</h2>
        </div>
        <div className="faq">
          {FAQS.map(([q, a], i) => (
            <div key={q} className="faq-item">
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span>{q}</span>
                <span className={"plus" + (open === i ? " on" : "")}>+</span>
              </button>
              {open === i && <p>{a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="cta">
        <h2>Start with the catalog</h2>
        <p>Browse everything without an account. Create one when you want to order.</p>
        <a className="btn" href="/catalog">Browse the catalog</a>
      </section>

      <footer className="foot">
        <div className="foot-cols">
          <div>
            <h4>Platform</h4>
            <a href="/catalog">Catalog</a>
            <a href="/how-it-works">How it works</a>
            <a href="/pricing">Pricing</a>
            <a href="/guarantee">Guarantee</a>
          </div>
          <div>
            <h4>Browse</h4>
            <a href="/catalog/niche/technology">Technology sites</a>
            <a href="/catalog/niche/finance">Finance sites</a>
            <a href="/catalog/country/germany">Sites in Germany</a>
            <a href="/catalog/country/india">Sites in India</a>
          </div>
          <div>
            <h4>Company</h4>
            <a href="/about">About</a>
            <a href="/vetting">Vetting standard</a>
            <a href="/case-studies">Case studies</a>
            <a href="/contact">Contact</a>
          </div>
          <div>
            <h4>Legal</h4>
            <a href="/terms">Terms of service</a>
            <a href="/privacy">Privacy</a>
            <a href="/refund-policy">Refund policy</a>
          </div>
        </div>
        <div className="foot-base">
          <span className="wordmark small">OUTPOST</span>
          <span>© 2026 · Registered company details and address go here</span>
        </div>
      </footer>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap');

.site{
  --ink:#16181d; --ink2:#3a4049; --mut:#697080; --rule:#e3e6eb;
  --canvas:#f4f5f8; --surf:#fff; --acc:#2f4bd8; --acc-soft:#e9edfc; --teal:#0e8a6e;
  font-family:'IBM Plex Sans',system-ui,sans-serif;color:var(--ink);
  background:var(--surf);font-size:16px;line-height:1.55;
}
.site *{box-sizing:border-box;}
.site a{color:inherit;text-decoration:none;}
.site h1,.site h2,.site h3,.site h4{font-family:'Archivo',sans-serif;margin:0;letter-spacing:-.015em;}
.mono{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;}
.site :focus-visible{outline:2px solid var(--acc);outline-offset:3px;}

.btn{display:inline-block;background:var(--acc);color:#fff;border:0;border-radius:6px;
  padding:11px 22px;font:inherit;font-weight:500;cursor:pointer;}
.btn.light{background:#fff;color:var(--ink);}
.txt-link{color:var(--acc);font-weight:500;}
.txt-link.arrow::after{content:" →";}

/* nav */
.nav{display:flex;align-items:center;gap:28px;padding:16px 32px;border-bottom:1px solid var(--rule);
  position:sticky;top:0;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);z-index:50;}
.brand{display:flex;align-items:center;gap:9px;}
.mark{width:14px;height:14px;background:var(--acc);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);}
.wordmark{font-family:'Archivo',sans-serif;font-weight:700;letter-spacing:.14em;font-size:15px;}
.wordmark.small{font-size:12px;}
.nav-links{display:flex;gap:22px;font-size:14.5px;color:var(--ink2);}
.nav-links a:hover{color:var(--acc);}
.nav-cta{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:14.5px;}

/* hero */
.hero{max-width:820px;margin:0 auto;padding:76px 32px 56px;text-align:center;}
.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin:0 0 18px;}
.hero h1{font-size:46px;line-height:1.12;font-weight:700;}
.h1-mut{color:var(--mut);}
.lede{font-size:17.5px;color:var(--ink2);max-width:640px;margin:20px auto 0;}
.hero-search{display:flex;gap:9px;max-width:520px;margin:30px auto 0;}
.hero-search input{flex:1;border:1px solid var(--rule);border-radius:6px;padding:12px 14px;font:inherit;}
.hero-note{font-size:13.5px;color:var(--mut);margin:12px 0 0;}

/* stats */
.stats{display:flex;justify-content:center;gap:0;border-block:1px solid var(--rule);
  background:var(--canvas);flex-wrap:wrap;}
.stat{display:flex;flex-direction:column;align-items:center;padding:26px 46px;}
.stat + .stat{border-left:1px solid var(--rule);}
.stat-n{font-size:30px;font-weight:500;line-height:1;}
.stat-l{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin-top:7px;}

/* bands */
.band{max-width:1040px;margin:0 auto;padding:76px 32px;}
.band.alt{max-width:none;background:var(--canvas);border-block:1px solid var(--rule);}
.band.alt > *{max-width:1040px;margin-left:auto;margin-right:auto;}
.band-head{max-width:620px;margin-bottom:38px;}
.band-head h2{font-size:31px;font-weight:600;}
.band-head p{color:var(--ink2);margin:14px 0 0;}

.rejects{list-style:none;padding:0;margin:0 0 30px;display:grid;
  grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:26px 40px;}
.rejects li{display:flex;gap:13px;}
.x{color:#a4322a;font-size:13px;margin-top:4px;flex:0 0 auto;}
.rejects h3{font-size:16px;font-weight:600;}
.rejects p{margin:5px 0 0;color:var(--ink2);font-size:14.5px;}

/* preview table */
.preview{background:var(--surf);border:1px solid var(--rule);border-radius:8px;
  overflow:hidden;margin-bottom:26px;}
.pv-head,.pv-row{display:grid;grid-template-columns:1fr 60px 90px 90px;gap:16px;
  align-items:center;padding:13px 20px;}
.pv-head{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);
  border-bottom:1px solid var(--rule);background:var(--canvas);}
.pv-row{border-bottom:1px solid var(--rule);}
.pv-row:last-child{border-bottom:0;}
.pv-site{display:flex;flex-direction:column;}
.pv-dom{font-weight:600;font-size:15px;}
.pv-meta{font-size:13px;color:var(--mut);}
.pv-dr{font-family:'Archivo',sans-serif;font-weight:600;font-size:17px;color:var(--acc);}
.pv-price{font-weight:500;}

/* steps */
.steps{list-style:none;padding:0;margin:0;display:grid;
  grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:32px;counter-reset:s;}
.steps li{border-top:2px solid var(--ink);padding-top:16px;}
.step-n{display:block;color:var(--acc);font-size:13px;margin-bottom:9px;}
.steps h3{font-size:17px;font-weight:600;}
.steps p{margin:8px 0 0;color:var(--ink2);font-size:14.5px;}

/* guarantee */
.guarantee{background:var(--ink);color:#fff;}
.g-in{max-width:1040px;margin:0 auto;padding:76px 32px;}
.g-in h2{font-size:31px;font-weight:600;max-width:560px;}
.g-in p{color:#c2c8d2;max-width:640px;margin:18px 0 0;}
.g-in .btn{margin-top:28px;}

/* cards */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:22px;}
.card{background:var(--surf);border:1px solid var(--rule);border-radius:8px;padding:26px;}
.card h3{font-size:18px;font-weight:600;}
.card p{margin:11px 0 0;color:var(--ink2);font-size:14.5px;}

/* faq */
.faq{border-top:1px solid var(--rule);}
.faq-item{border-bottom:1px solid var(--rule);}
.faq-item button{width:100%;display:flex;justify-content:space-between;align-items:center;
  gap:20px;background:none;border:0;padding:19px 0;font:inherit;font-weight:500;
  text-align:left;cursor:pointer;}
.plus{color:var(--acc);font-size:19px;transition:transform .15s;flex:0 0 auto;}
.plus.on{transform:rotate(45deg);}
.faq-item p{margin:0 0 20px;color:var(--ink2);max-width:720px;font-size:15px;}

/* cta */
.cta{text-align:center;padding:80px 32px;background:var(--acc-soft);border-top:1px solid var(--rule);}
.cta h2{font-size:31px;font-weight:600;}
.cta p{color:var(--ink2);margin:12px 0 26px;}

/* footer */
.foot{border-top:1px solid var(--rule);padding:52px 32px 26px;}
.foot-cols{max-width:1040px;margin:0 auto;display:grid;
  grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:32px;}
.foot-cols h4{font-size:11px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--mut);margin-bottom:13px;}
.foot-cols a{display:block;font-size:14.5px;color:var(--ink2);padding:4px 0;}
.foot-cols a:hover{color:var(--acc);}
.foot-base{max-width:1040px;margin:40px auto 0;padding-top:22px;border-top:1px solid var(--rule);
  display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;
  font-size:13px;color:var(--mut);}

@media (max-width:820px){
  .nav{gap:16px;padding:14px 18px;}
  .nav-links{display:none;}
  .hero{padding:52px 20px 40px;}
  .hero h1{font-size:32px;}
  .lede{font-size:16px;}
  .hero-search{flex-direction:column;}
  .stat{padding:20px 26px;}
  .stat + .stat{border-left:0;}
  .band,.g-in{padding:52px 20px;}
  .band-head h2,.g-in h2,.cta h2{font-size:25px;}
  .pv-head,.pv-row{grid-template-columns:1fr 46px 70px;gap:10px;padding:12px 14px;}
  .pv-head span:nth-child(3),.pv-row span:nth-child(3){display:none;}
  .foot{padding:40px 20px 20px;}
}
@media (prefers-reduced-motion:reduce){.site *{transition:none !important;}}
`;
