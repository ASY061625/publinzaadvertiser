"use client";

import {
  countryName,
  drBand,
  formatCents,
  formatTraffic,
  languageName,
  trafficBarWidth,
} from "@/lib/format";
import type { CatalogSite } from "./types";

const HIGH_SPAM = 7;

export function SiteRow({
  site,
  selected,
  onToggle,
}: {
  site: CatalogSite;
  selected: boolean;
  onToggle: () => void;
}) {
  const dr = site.metrics?.domainRating ?? null;
  const traffic = site.metrics?.organicTraffic ?? null;
  const spam = site.metrics?.spamScore ?? 0;
  const nofollow = site.linkType === "NOFOLLOW" || site.linkType === "SPONSORED";

  return (
    <li className={"row" + (selected ? " on" : "")}>
      <div className="row-main">
        <div className="row-title">
          <span className="domain">{site.domain}</span>
          {site.metrics?.gaVerified && (
            <span className="verified" title="Traffic verified via Google Analytics">
              verified
            </span>
          )}
          {nofollow && <span className="tag-nf">{site.linkType.toLowerCase()}</span>}
          {spam >= HIGH_SPAM && <span className="tag-risk">high spam score</span>}
          {site.channelType !== "WEBSITE" && (
            <span className="tag-chan">{site.channelType.toLowerCase()}</span>
          )}
        </div>
        <p className="row-meta">
          {countryName(site.country)} · {languageName(site.language)} ·{" "}
          {site.categories.map((c) => c.name).join(", ")} · publishes in {site.turnaroundDays} days
          {site.acceptsSensitive.length > 0 && (
            <span className="meta-sens"> · accepts {site.acceptsSensitive.join(", ")}</span>
          )}
        </p>
      </div>

      <div className="metric">
        <span className={"dr b" + drBand(dr)}>{dr ?? "—"}</span>
        <span className="metric-lab">DR</span>
      </div>

      <div className="metric wide">
        <span className="mono traffic">
          {formatTraffic(traffic)}
          {/* Someone making a $500 call deserves to know this reading is two
              months old. The threshold is decided server-side. */}
          {site.metrics?.stale && (
            <span className="stale" title="These metrics are over 30 days old">
              stale
            </span>
          )}
        </span>
        <span className="bar">
          <span className="bar-fill" style={{ width: trafficBarWidth(traffic) }} />
        </span>
        <span className="metric-lab">Monthly organic</span>
      </div>

      <div className="price">
        <span className="mono price-num">{formatCents(site.priceCents)}</span>
        <span className="metric-lab">
          {site.writingCents > 0 ? `+${formatCents(site.writingCents)} with writing` : "you supply the article"}
        </span>
      </div>

      <button
        className={"btn-add" + (selected ? " on" : "")}
        onClick={onToggle}
        aria-pressed={selected}
      >
        {selected ? "Added" : "Add"}
      </button>
    </li>
  );
}
