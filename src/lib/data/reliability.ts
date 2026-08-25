import { prisma } from "@/lib/db";

export type ReliabilityBreakdown = {
  reliability: number;
  onTimeRate: number | null;
  rejectionRate: number;
  avgDaysOverQuoted: number;
  deadLinkCount: number;
  sampleSize: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Computes a publisher's reliability from delivery history. Never hand-entered:
 * anything written directly to Publisher.reliability is overwritten the next
 * time this runs.
 *
 * Inputs, per PHASE4.md: on-time publish rate, rejection rate, average days
 * over the quoted turnaround, and the count of links that later went dead.
 *
 * A publisher with no history scores 100 rather than 0 — a new publisher is
 * unproven, not bad, and starting at zero would bury them below anyone who has
 * ever delivered anything.
 */
export async function computeReliability(publisherId: string): Promise<ReliabilityBreakdown> {
  const items = await prisma.orderItem.findMany({
    where: { site: { publisherId } },
    select: {
      id: true,
      status: true,
      publishedAt: true,
      site: { select: { turnaroundDays: true } },
      statusEvents: {
        where: { toStatus: "SUBMITTED_TO_PUBLISHER" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
      linkChecks: {
        orderBy: { checkedAt: "desc" },
        take: 1,
        select: { linkPresent: true },
      },
    },
  });

  if (items.length === 0) {
    return {
      reliability: 100,
      onTimeRate: null,
      rejectionRate: 0,
      avgDaysOverQuoted: 0,
      deadLinkCount: 0,
      sampleSize: 0,
    };
  }

  const rejected = items.filter((i) => i.status === "REJECTED").length;
  const rejectionRate = Math.round((rejected / items.length) * 100);

  // Only placements that actually reached the publisher and got published can
  // be judged on timeliness.
  const timed = items.filter((i) => i.publishedAt && i.statusEvents.length > 0);

  let onTimeRate: number | null = null;
  let avgDaysOverQuoted = 0;

  if (timed.length > 0) {
    let onTime = 0;
    let totalDaysOver = 0;

    for (const item of timed) {
      const submittedAt = item.statusEvents[0].createdAt.getTime();
      const publishedAt = item.publishedAt!.getTime();
      const tookDays = (publishedAt - submittedAt) / DAY_MS;
      const quoted = item.site.turnaroundDays;

      if (tookDays <= quoted) onTime += 1;
      else totalDaysOver += tookDays - quoted;
    }

    onTimeRate = Math.round((onTime / timed.length) * 100);
    avgDaysOverQuoted = Math.round(totalDaysOver / timed.length);
  }

  const deadLinkCount = items.filter(
    (i) => i.linkChecks.length > 0 && i.linkChecks[0].linkPresent === false
  ).length;

  // Start at 100 and deduct. Weights are deliberately blunt — this is a
  // triage signal for staff, not a statistical model.
  let score = 100;
  score -= rejectionRate; // a rejection is the worst outcome
  if (onTimeRate !== null) score -= Math.round((100 - onTimeRate) * 0.5);
  score -= Math.min(20, avgDaysOverQuoted * 2);
  score -= Math.min(20, deadLinkCount * 5);

  return {
    reliability: Math.max(0, Math.min(100, score)),
    onTimeRate,
    rejectionRate,
    avgDaysOverQuoted,
    deadLinkCount,
    sampleSize: items.length,
  };
}

/** Computes and stores. Called after every item status change. */
export async function recomputeAndStore(publisherId: string): Promise<ReliabilityBreakdown> {
  const breakdown = await computeReliability(publisherId);

  await prisma.publisher.update({
    where: { id: publisherId },
    data: {
      reliability: breakdown.reliability,
      onTimeRate: breakdown.onTimeRate,
      rejectionRate: breakdown.rejectionRate,
      avgDaysOverQuoted: breakdown.avgDaysOverQuoted,
      deadLinkCount: breakdown.deadLinkCount,
      reliabilityComputedAt: new Date(),
    },
  });

  return breakdown;
}

/** Resolves the publisher behind an item, if any, so callers can recompute. */
export async function publisherForItem(orderItemId: string): Promise<string | null> {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: { site: { select: { publisherId: true } } },
  });
  return item?.site.publisherId ?? null;
}
