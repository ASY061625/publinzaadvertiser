import type { ItemStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, isPricingAdmin, isStaff, type Actor } from "./actor";
import { writeAudit } from "./audit";

/**
 * The internal order queue.
 *
 * Both staff roles work here, but they see different columns: cost, margin and
 * the publisher's payout terms are ADMIN-only. The split is done by *omitting*
 * the fields from the returned object rather than blanking them, so an EDITOR's
 * payload cannot contain the string "costCents" at all (PHASE4.md test 1).
 */
function assertStaff(actor: Actor) {
  if (!isStaff(actor)) throw new NotFoundError();
}

export type QueueItemBase = {
  id: string;
  status: ItemStatus;
  domain: string;
  targetUrl: string;
  anchorText: string;
  contentSource: string;
  articleUrl: string | null;
  briefNotes: string | null;
  publishedUrl: string | null;
  priceCents: number;
  orderId: string;
  orderReference: string;
  advertiserEmail: string;
  projectName: string | null;
  assignedToId: string | null;
  assignedToEmail: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  turnaroundDays: number;
  /** Days past the quoted turnaround since submission; 0 when not overdue. */
  daysOverdue: number;
  siteCountry: string;
  publisherName: string | null;
  publisherEmail: string | null;
  publisherTelegram: string | null;
};

/** Only ever present for an ADMIN. */
export type QueueItemPricing = {
  costCents: number;
  marginCents: number;
  marginPct: number;
};

export type QueueItem = QueueItemBase & Partial<QueueItemPricing>;

export type QueueFilters = {
  status?: ItemStatus | null;
  assignedToId?: string | null;
  orderId?: string | null;
  country?: string | null;
  /** Only items past their quoted turnaround since SUBMITTED_TO_PUBLISHER. */
  overdueOnly?: boolean;
  /** Only items whose order was placed at least this many days ago. */
  minAgeDays?: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function listQueue(actor: Actor, filters: QueueFilters): Promise<QueueItem[]> {
  assertStaff(actor);

  const where: Prisma.OrderItemWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.assignedToId) where.assignedToId = filters.assignedToId;
  if (filters.orderId) where.orderId = filters.orderId;
  if (filters.country) where.site = { country: filters.country.toUpperCase() };
  if (filters.minAgeDays) {
    where.order = { createdAt: { lte: new Date(Date.now() - filters.minAgeDays * DAY_MS) } };
  }

  const rows = await prisma.orderItem.findMany({
    where,
    orderBy: [{ status: "asc" }, { id: "asc" }],
    take: 500,
    select: {
      id: true,
      status: true,
      targetUrl: true,
      anchorText: true,
      contentSource: true,
      articleUrl: true,
      briefNotes: true,
      publishedUrl: true,
      priceCents: true,
      costCents: true,
      orderId: true,
      assignedToId: true,
      site: {
        select: {
          domain: true,
          country: true,
          turnaroundDays: true,
          // An editor needs the publisher's contact details for the placements
          // they fulfil; payout terms are excluded for both roles here.
          publisher: { select: { name: true, email: true, telegram: true } },
        },
      },
      assignedTo: { select: { email: true } },
      statusEvents: {
        where: { toStatus: "SUBMITTED_TO_PUBLISHER" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
      order: {
        select: {
          reference: true,
          createdAt: true,
          user: { select: { email: true } },
          project: { select: { name: true } },
        },
      },
    },
  });

  const now = Date.now();
  const showPricing = isPricingAdmin(actor);

  const mapped = rows.map((r) => {
    const submittedAt = r.statusEvents[0]?.createdAt ?? null;

    // Overdue only means anything once it is actually with the publisher and
    // not yet live.
    const stillWaiting = r.status === "SUBMITTED_TO_PUBLISHER" || r.status === "REVISION_REQUESTED";
    const daysOverdue =
      submittedAt && stillWaiting
        ? Math.max(
            0,
            Math.floor((now - submittedAt.getTime()) / DAY_MS) - r.site.turnaroundDays
          )
        : 0;

    const base: QueueItemBase = {
      id: r.id,
      status: r.status,
      domain: r.site.domain,
      targetUrl: r.targetUrl,
      anchorText: r.anchorText,
      contentSource: r.contentSource,
      articleUrl: r.articleUrl,
      briefNotes: r.briefNotes,
      publishedUrl: r.publishedUrl,
      priceCents: r.priceCents,
      orderId: r.orderId,
      orderReference: r.order.reference,
      advertiserEmail: r.order.user.email,
      projectName: r.order.project?.name ?? null,
      assignedToId: r.assignedToId,
      assignedToEmail: r.assignedTo?.email ?? null,
      createdAt: r.order.createdAt,
      submittedAt,
      turnaroundDays: r.site.turnaroundDays,
      daysOverdue,
      siteCountry: r.site.country,
      publisherName: r.site.publisher?.name ?? null,
      publisherEmail: r.site.publisher?.email ?? null,
      publisherTelegram: r.site.publisher?.telegram ?? null,
    };

    if (!showPricing) return base;

    const marginCents = r.priceCents - r.costCents;
    return {
      ...base,
      costCents: r.costCents,
      marginCents,
      marginPct: r.priceCents > 0 ? Math.round((marginCents / r.priceCents) * 100) : 0,
    };
  });

  return filters.overdueOnly ? mapped.filter((i) => i.daysOverdue > 0) : mapped;
}

export async function listEditors(actor: Actor) {
  assertStaff(actor);
  return prisma.user.findMany({
    where: { role: { in: ["EDITOR", "ADMIN"] } },
    select: { id: true, email: true, name: true },
    orderBy: { email: "asc" },
  });
}

export async function assignItem(actor: Actor, orderItemId: string, editorId: string | null) {
  assertStaff(actor);

  if (editorId) {
    const editor = await prisma.user.findFirst({
      where: { id: editorId, role: { in: ["EDITOR", "ADMIN"] } },
      select: { id: true },
    });
    if (!editor) throw new NotFoundError();
  }

  const existing = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: { assignedToId: true },
  });
  if (!existing) throw new NotFoundError();

  return prisma.$transaction(async (tx) => {
    await tx.orderItem.update({
      where: { id: orderItemId },
      data: { assignedToId: editorId },
    });

    await writeAudit(tx, actor, {
      action: "item.assign",
      entityType: "OrderItem",
      entityId: orderItemId,
      before: { assignedToId: existing.assignedToId },
      after: { assignedToId: editorId },
    });
  });
}

/** Assign a selection in one go — the fulfilment lead's Monday-morning move. */
export async function bulkAssign(actor: Actor, orderItemIds: string[], editorId: string | null) {
  assertStaff(actor);
  if (orderItemIds.length === 0) throw new ValidationError("Select at least one placement.");
  if (orderItemIds.length > 200) throw new ValidationError("Assign at most 200 placements at once.");

  for (const id of orderItemIds) await assignItem(actor, id, editorId);
  return { assigned: orderItemIds.length };
}

export async function queueCounts(actor: Actor) {
  assertStaff(actor);
  const rows = await prisma.orderItem.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

/** Per-item correspondence: what was sent to the publisher, and when. */
export async function addCorrespondence(actor: Actor, orderItemId: string, body: string) {
  assertStaff(actor);

  const trimmed = body?.trim() ?? "";
  if (!trimmed) throw new ValidationError("A correspondence entry needs some text.");
  if (trimmed.length > 5000) throw new ValidationError("That entry is too long.");

  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: { id: true },
  });
  if (!item) throw new NotFoundError();

  return prisma.$transaction(async (tx) => {
    const entry = await tx.itemCorrespondence.create({
      data: { orderItemId, body: trimmed, actorUserId: actor.id },
      select: { id: true, body: true, createdAt: true },
    });

    await writeAudit(tx, actor, {
      action: "item.correspondence",
      entityType: "OrderItem",
      entityId: orderItemId,
      before: null,
      after: entry,
    });

    return entry;
  });
}

export async function listCorrespondence(actor: Actor, orderItemId: string) {
  assertStaff(actor);
  return prisma.itemCorrespondence.findMany({
    where: { orderItemId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      body: true,
      createdAt: true,
      actor: { select: { email: true } },
    },
  });
}
