import type { LinkCheckOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Link verification — the guarantee that makes the product trustworthy.
 *
 * The central rule: **a fetch failure is not a dead link.** Many publishers
 * block datacentre IPs, and treating a 403 as a removed link would refund
 * money for placements that are perfectly live. Blocked and errored fetches go
 * to manual review and count toward nothing.
 */

export type FetchResult = {
  /** Whether the request completed at all; false means a network-level failure. */
  ok: boolean;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectCount: number;
  body: string;
  indexed: boolean | null;
  error?: string;
};

export interface LinkFetcher {
  (url: string, attempt: number): Promise<FetchResult>;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Outpost-LinkChecker/1.0 (+https://outpost.example/bot)",
];

/** Real fetcher: follows redirects, rotates user agent per attempt. */
export const httpFetcher: LinkFetcher = async (url, attempt) => {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENTS[(attempt - 1) % USER_AGENTS.length],
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20_000),
    });

    const body = await res.text();
    return {
      ok: true,
      httpStatus: res.status,
      finalUrl: res.url || url,
      // fetch collapses the chain, so a differing final URL is the signal that
      // one happened rather than a counted hop.
      redirectCount: res.url && res.url !== url ? 1 : 0,
      body,
      indexed: null,
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: null,
      finalUrl: null,
      redirectCount: 0,
      body: "",
      indexed: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

let fakeFetcher: LinkFetcher | null = null;

export function setFakeFetcher(fetcher: LinkFetcher | null) {
  fakeFetcher = fetcher;
}

function fetcher(): LinkFetcher {
  return fakeFetcher ?? httpFetcher;
}

/* ─────────────────────────  parsing  ───────────────────────── */

export type FoundLink = { href: string; rel: string | null; anchorText: string };

/** Finds anchors pointing at the target, ignoring trailing-slash and case noise. */
export function findLinks(body: string, targetUrl: string): FoundLink[] {
  const normalise = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const target = normalise(targetUrl);

  const found: FoundLink[] = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of body.matchAll(anchorRe)) {
    const attrs = match[1];
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href || normalise(href) !== target) continue;

    found.push({
      href,
      rel: /rel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? null,
      anchorText: match[2].replace(/<[^>]*>/g, "").trim(),
    });
  }
  return found;
}

const CHALLENGE_MARKERS = [
  "cf-browser-verification",
  "just a moment",
  "checking your browser",
  "captcha",
  "attention required",
];

function looksLikeChallenge(body: string): boolean {
  const haystack = body.slice(0, 4_000).toLowerCase();
  return CHALLENGE_MARKERS.some((m) => haystack.includes(m));
}

function samePage(a: string | null, b: string): boolean {
  if (!a) return false;
  const strip = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return strip(a) === strip(b);
}

export type Classification = {
  outcome: LinkCheckOutcome;
  linkPresent: boolean;
  linkTypeSeen: string | null;
  anchorTextSeen: string | null;
  manualReview: boolean;
  note?: string;
};

/**
 * Turns a fetch into one of the failure modes in PHASE6.md's table. Each is a
 * different problem with a different response, so they are never collapsed
 * into a single boolean.
 */
export function classify(input: {
  result: FetchResult;
  publishedUrl: string;
  targetUrl: string;
  expectedAnchor: string;
  expectedDofollow: boolean;
}): Classification {
  const { result, publishedUrl, targetUrl, expectedAnchor, expectedDofollow } = input;

  // Network failure — we learned nothing about the link.
  if (!result.ok) {
    return {
      outcome: "FETCH_ERROR",
      linkPresent: false,
      linkTypeSeen: null,
      anchorTextSeen: null,
      manualReview: true,
      note: result.error,
    };
  }

  const status = result.httpStatus ?? 0;

  // The publisher is blocking us. Not evidence about the link.
  if (status === 403 || status === 429 || status === 401) {
    return {
      outcome: "BLOCKED",
      linkPresent: false,
      linkTypeSeen: null,
      anchorTextSeen: null,
      manualReview: true,
      note: `HTTP ${status}`,
    };
  }

  if (status === 404 || status === 410) {
    return {
      outcome: "ARTICLE_DELETED",
      linkPresent: false,
      linkTypeSeen: null,
      anchorTextSeen: null,
      manualReview: false,
      note: `HTTP ${status}`,
    };
  }

  if (status >= 500) {
    return {
      outcome: "FETCH_ERROR",
      linkPresent: false,
      linkTypeSeen: null,
      anchorTextSeen: null,
      manualReview: true,
      note: `HTTP ${status}`,
    };
  }

  // A 200 that is really a bot challenge.
  if (looksLikeChallenge(result.body)) {
    return {
      outcome: "BLOCKED",
      linkPresent: false,
      linkTypeSeen: null,
      anchorTextSeen: null,
      manualReview: true,
      note: "bot challenge page",
    };
  }

  const links = findLinks(result.body, targetUrl);

  if (links.length === 0) {
    // Article intact, link gone — the most common real failure.
    return {
      outcome: "LINK_ABSENT",
      linkPresent: false,
      linkTypeSeen: null,
      anchorTextSeen: null,
      manualReview: false,
    };
  }

  const link = links[0];
  const rel = link.rel;
  const isNofollow = !!rel && /\bnofollow\b|\bsponsored\b|\bugc\b/.test(rel);
  const linkTypeSeen = isNofollow ? "nofollow" : "dofollow";

  const base = {
    linkPresent: true,
    linkTypeSeen,
    anchorTextSeen: link.anchorText,
    manualReview: false,
  };

  // Order matters: a link quietly made nofollow is worse than a moved article,
  // and an anchor swap is worse than a URL change, so the more serious
  // classification wins when several apply.
  if (expectedDofollow && isNofollow) {
    return { ...base, outcome: "REL_CHANGED", note: `rel="${rel}"` };
  }

  if (expectedAnchor && link.anchorText.toLowerCase() !== expectedAnchor.toLowerCase()) {
    return { ...base, outcome: "ANCHOR_CHANGED" };
  }

  if (result.indexed === false) {
    return { ...base, outcome: "DEINDEXED" };
  }

  if (!samePage(result.finalUrl, publishedUrl)) {
    // Reached a different URL than the one we bought. Distinguishes a redirect
    // to a new path from a silent move to an archive or paginated page.
    return {
      ...base,
      outcome: result.redirectCount > 0 ? "ARTICLE_MOVED" : "URL_CHANGED",
      note: `final URL ${result.finalUrl}`,
    };
  }

  return { ...base, outcome: "OK" };
}

/** Outcomes that count as the link genuinely not being delivered. */
export const FAILING_OUTCOMES: LinkCheckOutcome[] = [
  "LINK_ABSENT",
  "ARTICLE_DELETED",
  "REL_CHANGED",
  "ANCHOR_CHANGED",
  "URL_CHANGED",
  "DEINDEXED",
];

export function isFailure(outcome: LinkCheckOutcome): boolean {
  return FAILING_OUTCOMES.includes(outcome);
}

/* ─────────────────────────  running  ───────────────────────── */

const MAX_ATTEMPTS = 3;

/**
 * Runs one check for one item and records exactly one LinkCheck row.
 *
 * Blocked and errored fetches are retried with backoff and a rotated user agent
 * before being recorded, because a single 403 usually means the first UA was
 * unlucky rather than that the publisher has blocked us for good.
 */
export async function runCheckForItem(orderItemId: string) {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      publishedUrl: true,
      targetUrl: true,
      anchorText: true,
      status: true,
      site: { select: { linkType: true, publisherId: true } },
    },
  });

  // Only a live placement can be checked.
  if (!item?.publishedUrl || item.status !== "VERIFIED") return null;

  let result: FetchResult | null = null;
  let classification: Classification | null = null;
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    result = await fetcher()(item.publishedUrl, attempt);
    classification = classify({
      result,
      publishedUrl: item.publishedUrl,
      targetUrl: item.targetUrl,
      expectedAnchor: item.anchorText,
      expectedDofollow: item.site.linkType === "DOFOLLOW" || item.site.linkType === "MIXED",
    });

    // Only blocked/errored fetches are worth retrying; a link that is genuinely
    // absent will still be absent on the next request.
    if (!classification.manualReview) break;
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2 ** attempt * 10));
  }

  const check = await prisma.linkCheck.create({
    data: {
      orderItemId: item.id,
      httpStatus: result!.httpStatus,
      linkPresent: classification!.linkPresent,
      linkTypeSeen: classification!.linkTypeSeen,
      indexed: result!.indexed,
      outcome: classification!.outcome,
      finalUrl: result!.finalUrl,
      redirectCount: result!.redirectCount,
      anchorTextSeen: classification!.anchorTextSeen,
      manualReview: classification!.manualReview,
      attempt,
      note: classification!.note ?? null,
    },
  });

  const { reconcileAlerts } = await import("./guarantee");
  await reconcileAlerts(item.id, check.outcome, item.site.publisherId);

  return check;
}
