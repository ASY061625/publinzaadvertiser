import type { LinkCheckOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, isStaff, type Actor } from "@/lib/data/actor";
import { isFailure } from "./link-check";

/**
 * Guarantee enforcement.
 *
 * Two deliberate refusals here:
 *   - Nothing auto-refunds. When an item becomes eligible it is flagged for
 *     staff, who choose between chasing a replacement placement and issuing the
 *     refund. Replacement is usually better for both sides and keeps the revenue.
 *   - Blocked and errored checks never count. A publisher blocking datacentre
 *     IPs is not a missing link, and refunding on it would be paying for our own
 *     infrastructure problem.
 */

const DAY = 24 * 60 * 60 * 1000;

export const REQUIRED_CONSECUTIVE_FAILURES = 3;
export const REQUIRED_SPAN_DAYS = 3;

export type Eligibility = {
  eligible: boolean;
  /** Consecutive failing checks, most recent first, ignoring manual-review ones. */
  failedChecks: number;
  spanDays: number;
  firstFailureAt: Date | null;
  lastFailureAt: Date | null;
  outcome: LinkCheckOutcome | null;
};

/**
 * Refund eligibility: three consecutive failures spanning at least three days.
 *
 * Single-check refunds bankrupt you on transient outages, and three retries
 * within one afternoon are the same outage rather than three problems — hence
 * both a count and a span.
 */
export async function refundEligibility(orderItemId: string): Promise<Eligibility> {
  const checks = await prisma.linkCheck.findMany({
    where: { orderItemId },
    orderBy: { checkedAt: "desc" },
    select: { outcome: true, checkedAt: true, manualReview: true },
  });

  const streak: { outcome: LinkCheckOutcome; checkedAt: Date }[] = [];

  for (const check of checks) {
    // A blocked or errored check is not evidence either way: it neither counts
    // as a failure nor breaks a run of them.
    if (check.manualReview) continue;

    if (isFailure(check.outcome)) {
      streak.push({ outcome: check.outcome, checkedAt: check.checkedAt });
    } else {
      break; // a passing check ends the streak
    }
  }

  if (streak.length === 0) {
    return {
      eligible: false,
      failedChecks: 0,
      spanDays: 0,
      firstFailureAt: null,
      lastFailureAt: null,
      outcome: null,
    };
  }

  const lastFailureAt = streak[0].checkedAt;
  const firstFailureAt = streak[streak.length - 1].checkedAt;
  const spanDays = (lastFailureAt.getTime() - firstFailureAt.getTime()) / DAY;

  return {
    eligible:
      streak.length >= REQUIRED_CONSECUTIVE_FAILURES && spanDays >= REQUIRED_SPAN_DAYS,
    failedChecks: streak.length,
    spanDays,
    firstFailureAt,
    lastFailureAt,
    outcome: streak[0].outcome,
  };
}

/**
 * Opens, updates or resolves the alert for an item after a check.
 *
 * One alert per incident, not one per failed check — a link that has been gone
 * for a week is one problem, and a queue with seven rows for it is unusable.
 */
export async function reconcileAlerts(
  orderItemId: string,
  outcome: LinkCheckOutcome,
  publisherId?: string | null
) {
  const open = await prisma.linkAlert.findFirst({
    where: { orderItemId, resolvedAt: null },
  });

  if (outcome === "OK") {
    if (open) {
      await prisma.linkAlert.update({
        where: { id: open.id },
        data: { resolvedAt: new Date(), resolution: "Link restored and verified on a later check" },
      });
    }
    return;
  }

  // Blocked and errored checks do not raise an alert about the link itself;
  // they are surfaced through the manual-review queue instead.
  if (!isFailure(outcome)) return;

  const eligibility = await refundEligibility(orderItemId);

  if (open) {
    await prisma.linkAlert.update({
      where: { id: open.id },
      data: {
        outcome,
        refundEligibleAt: eligibility.eligible ? (open.refundEligibleAt ?? new Date()) : null,
      },
    });
  } else {
    await prisma.linkAlert.create({
      data: {
        orderItemId,
        outcome,
        refundEligibleAt: eligibility.eligible ? new Date() : null,
      },
    });
  }

  // A publisher whose links keep vanishing is a supply problem, not a series of
  // incidents, so it feeds the Phase 4 reliability score.
  if (publisherId) {
    try {
      const { recomputeAndStore } = await import("@/lib/data/reliability");
      await recomputeAndStore(publisherId);
    } catch (err) {
      console.error("Reliability recompute after link alert failed", publisherId, err);
    }
  }
}

/** Staff queue. Advertisers are deliberately never shown these directly. */
export async function openAlerts() {
  return prisma.linkAlert.findMany({
    where: { resolvedAt: null },
    orderBy: [{ refundEligibleAt: "asc" }, { openedAt: "asc" }],
    take: 500,
    select: {
      id: true,
      orderItemId: true,
      outcome: true,
      openedAt: true,
      refundEligibleAt: true,
      acknowledgedBy: true,
      orderItem: {
        select: {
          publishedUrl: true,
          targetUrl: true,
          anchorText: true,
          priceCents: true,
          order: { select: { reference: true, user: { select: { email: true } } } },
          site: { select: { domain: true, publisher: { select: { name: true } } } },
        },
      },
    },
  });
}

/** Checks that could not be completed — a human decides what they mean. */
export async function manualReviewQueue() {
  return prisma.linkCheck.findMany({
    where: { manualReview: true, checkedAt: { gte: new Date(Date.now() - 14 * DAY) } },
    orderBy: { checkedAt: "desc" },
    take: 200,
    select: {
      id: true,
      orderItemId: true,
      outcome: true,
      httpStatus: true,
      note: true,
      attempt: true,
      checkedAt: true,
      orderItem: { select: { publishedUrl: true, site: { select: { domain: true } } } },
    },
  });
}

export async function acknowledgeAlert(actor: Actor, alertId: string, resolution?: string) {
  if (!isStaff(actor)) throw new NotFoundError();

  const alert = await prisma.linkAlert.findUnique({ where: { id: alertId } });
  if (!alert) throw new NotFoundError();

  return prisma.linkAlert.update({
    where: { id: alertId },
    data: {
      acknowledgedBy: actor.id,
      ...(resolution ? { resolvedAt: new Date(), resolution } : {}),
    },
  });
}

/* ─────────────────────────  cadence  ───────────────────────── */

/**
 * Daily for the first week after publication, weekly thereafter, for the full
 * guarantee window. Most removals happen early, when a publisher does a cleanup
 * pass or an editor notices a sponsored post.
 */
export function isCheckDue(input: {
  publishedAt: Date;
  guaranteeDays: number;
  lastCheckedAt: Date | null;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const sincePublished = now.getTime() - input.publishedAt.getTime();

  if (sincePublished > input.guaranteeDays * DAY) return false; // window closed
  if (!input.lastCheckedAt) return true;

  const sinceCheck = now.getTime() - input.lastCheckedAt.getTime();
  const interval = sincePublished <= 7 * DAY ? DAY : 7 * DAY;
  return sinceCheck >= interval;
}

/** Items inside their guarantee window that are due a check. */
export async function dueForCheck(limit = 500): Promise<string[]> {
  const items = await prisma.orderItem.findMany({
    where: { status: "VERIFIED", publishedUrl: { not: null }, publishedAt: { not: null } },
    select: {
      id: true,
      publishedAt: true,
      site: { select: { guaranteeDays: true } },
      linkChecks: { orderBy: { checkedAt: "desc" }, take: 1, select: { checkedAt: true } },
    },
    take: 5_000,
  });

  return items
    .filter((item) =>
      isCheckDue({
        publishedAt: item.publishedAt!,
        guaranteeDays: item.site.guaranteeDays,
        lastCheckedAt: item.linkChecks[0]?.checkedAt ?? null,
      })
    )
    .slice(0, limit)
    .map((i) => i.id);
}
