import type { ContentSource, ItemStatus, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, type Actor } from "./actor";
import { deriveOrderStatus } from "./item-status";

export type PlacementItem = {
  siteId: string;
  targetUrl: string;
  anchorText: string;
  contentSource: ContentSource;
  briefNotes?: string | null;
  articleUrl?: string | null;
};

export type PlaceOrderInput = {
  idempotencyKey: string;
  projectId: string;
  items: PlacementItem[];
};

/**
 * The advertiser-facing shape of an order.
 *
 * `costCents` is absent by construction: it is never selected, so it cannot be
 * forgotten in a serializer later. CLAUDE.md rule 1.
 */
export type OrderItemView = {
  id: string;
  siteId: string;
  domain: string;
  status: ItemStatus;
  targetUrl: string;
  anchorText: string;
  contentSource: ContentSource;
  articleUrl: string | null;
  briefNotes: string | null;
  priceCents: number;
  publishedUrl: string | null;
  publishedAt: Date | null;
};

export type OrderView = {
  id: string;
  reference: string;
  status: OrderStatus;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  placedAt: Date | null;
  createdAt: Date;
  projectId: string | null;
  projectName: string | null;
  items: OrderItemView[];
};

const ORDER_ITEM_SELECT = {
  id: true,
  siteId: true,
  status: true,
  targetUrl: true,
  anchorText: true,
  contentSource: true,
  articleUrl: true,
  briefNotes: true,
  priceCents: true,
  publishedUrl: true,
  publishedAt: true,
  site: { select: { domain: true } },
} satisfies Prisma.OrderItemSelect;

const ORDER_SELECT = {
  id: true,
  reference: true,
  status: true,
  subtotalCents: true,
  totalCents: true,
  currency: true,
  placedAt: true,
  createdAt: true,
  projectId: true,
  project: { select: { name: true } },
  items: { select: ORDER_ITEM_SELECT, orderBy: { id: "asc" } },
} satisfies Prisma.OrderSelect;

type RawOrder = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

function toView(order: RawOrder): OrderView {
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    subtotalCents: order.subtotalCents,
    totalCents: order.totalCents,
    currency: order.currency,
    placedAt: order.placedAt,
    createdAt: order.createdAt,
    projectId: order.projectId,
    projectName: order.project?.name ?? null,
    items: order.items.map((i) => ({
      id: i.id,
      siteId: i.siteId,
      domain: i.site.domain,
      status: i.status,
      targetUrl: i.targetUrl,
      anchorText: i.anchorText,
      contentSource: i.contentSource,
      articleUrl: i.articleUrl,
      briefNotes: i.briefNotes,
      priceCents: i.priceCents,
      publishedUrl: i.publishedUrl,
      publishedAt: i.publishedAt,
    })),
  };
}

export const ANCHOR_MAX = 120;

/** Warnings are returned, not thrown — a subdomain target is odd, not wrong. */
export type ItemWarning = { index: number; field: string; message: string };

function validateItem(
  item: PlacementItem,
  index: number,
  projectHost: string | null,
  warnings: ItemWarning[]
) {
  const anchorText = item.anchorText?.trim() ?? "";
  if (anchorText.length < 1) throw new ValidationError(`Item ${index + 1}: anchor text is required.`);
  if (anchorText.length > ANCHOR_MAX) {
    throw new ValidationError(`Item ${index + 1}: anchor text must be ${ANCHOR_MAX} characters or fewer.`);
  }

  const raw = item.targetUrl?.trim() ?? "";
  if (!raw) throw new ValidationError(`Item ${index + 1}: target URL is required.`);

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`Item ${index + 1}: target URL must be a well-formed absolute URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(`Item ${index + 1}: target URL must be http or https.`);
  }

  // Host mismatch warns rather than blocks: agencies do point at client subdomains.
  if (projectHost && parsed.host.toLowerCase() !== projectHost.toLowerCase()) {
    warnings.push({
      index,
      field: "targetUrl",
      message: `${parsed.host} is not the project's domain (${projectHost}).`,
    });
  }

  return { anchorText, targetUrl: parsed.toString() };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Sequential reference within the calendar year: ORD-YYYY-NNNNN.
 *
 * The counter row is incremented atomically inside the placement transaction,
 * so two concurrent placements cannot be handed the same number.
 */
async function nextReference(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const counter = await tx.orderCounter.upsert({
    where: { year },
    create: { year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return `ORD-${year}-${String(counter.lastNumber).padStart(5, "0")}`;
}

/** Keys are namespaced per user so two advertisers cannot collide. */
function scopedKey(actor: Actor, key: string): string {
  return `${actor.id}:${key}`;
}

export type PlaceOrderResult = OrderView & { warnings: ItemWarning[]; reused: boolean };

export async function placeOrder(actor: Actor, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const key = input.idempotencyKey?.trim();
  if (!key) throw new ValidationError("An idempotency key is required to place an order.");
  if (key.length > 200) throw new ValidationError("That idempotency key is too long.");

  const stored = scopedKey(actor, key);

  // Fast path: this key already placed an order.
  const existing = await prisma.order.findUnique({ where: { idempotencyKey: stored }, select: ORDER_SELECT });
  if (existing) return { ...toView(existing), warnings: [], reused: true };

  if (!input.items || input.items.length === 0) {
    throw new ValidationError("An order needs at least one item.");
  }

  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: actor.id },
    select: { id: true, targetUrl: true },
  });
  if (!project) throw new NotFoundError();

  const projectHost = hostOf(project.targetUrl);
  const warnings: ItemWarning[] = [];
  const cleaned = input.items.map((item, i) => ({
    ...item,
    ...validateItem(item, i, projectHost, warnings),
  }));

  const siteIds = [...new Set(cleaned.map((i) => i.siteId))];
  const sites = await prisma.site.findMany({
    where: { id: { in: siteIds }, isActive: true },
    select: { id: true, priceCents: true, costCents: true, writingCents: true },
  });
  if (sites.length !== siteIds.length) {
    throw new ValidationError("One or more of those sites is no longer available.");
  }
  const priceBySite = new Map(sites.map((s) => [s.id, s]));

  const year = new Date().getFullYear();

  try {
    const order = await prisma.$transaction(async (tx) => {
      const reference = await nextReference(tx, year);

      // Prices are read from the catalog here and written onto the item, so a
      // later catalog change cannot reach this order. CLAUDE.md rule 2.
      const itemRows = cleaned.map((item) => {
        const site = priceBySite.get(item.siteId)!;
        const writing = item.contentSource === "PLATFORM" ? site.writingCents : 0;
        return {
          siteId: item.siteId,
          status: "QUEUED" as ItemStatus,
          targetUrl: item.targetUrl,
          anchorText: item.anchorText,
          contentSource: item.contentSource,
          articleUrl: item.articleUrl?.trim() || null,
          briefNotes: item.briefNotes?.trim() || null,
          priceCents: site.priceCents + writing,
          costCents: site.costCents,
        };
      });

      const subtotal = itemRows.reduce((n, i) => n + i.priceCents, 0);

      const createdOrder = await tx.order.create({
        data: {
          reference,
          userId: actor.id,
          projectId: project.id,
          // Phase 5: an order is unpaid until checkout authorises it, and
          // fulfilment is blocked while it sits here. Before payments existed
          // this went straight to IN_PROGRESS.
          status: "PENDING_PAYMENT",
          subtotalCents: subtotal,
          totalCents: subtotal,
          placedAt: new Date(),
          idempotencyKey: stored,
          items: { create: itemRows },
        },
        select: ORDER_SELECT,
      });

      // Placement is itself a status change, so it belongs in the audit trail.
      await tx.itemStatusEvent.createMany({
        data: createdOrder.items.map((i) => ({
          orderItemId: i.id,
          fromStatus: null,
          toStatus: "QUEUED" as ItemStatus,
          actorUserId: actor.id,
          note: "Order placed",
        })),
      });

      // The cart is emptied of exactly what was ordered, for this project.
      await tx.cartLine.deleteMany({
        where: {
          cart: { userId: actor.id },
          projectId: project.id,
          siteId: { in: siteIds },
        },
      });

      return createdOrder;
    });

    return { ...toView(order), warnings, reused: false };
  } catch (err) {
    // Lost a race on the unique key: the winner's order is the answer.
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "P2002"
    ) {
      const winner = await prisma.order.findUnique({
        where: { idempotencyKey: stored },
        select: ORDER_SELECT,
      });
      if (winner) return { ...toView(winner), warnings: [], reused: true };
    }
    throw err;
  }
}

export type OrderFilters = { projectId?: string | null; status?: OrderStatus | null };

export async function listOrders(actor: Actor, filters: OrderFilters) {
  const where: Prisma.OrderWhereInput = { userId: actor.id };
  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.status) where.status = filters.status;

  const orders = await prisma.order.findMany({
    where,
    select: ORDER_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return { orders: orders.map(toView) };
}

export async function getOrder(actor: Actor, orderId: string): Promise<OrderView> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: actor.id },
    select: ORDER_SELECT,
  });
  if (!order) throw new NotFoundError();
  return toView(order);
}

/**
 * The one change an advertiser may make after placement: cancelling an item
 * that has not been started. Routed through the transition function so it is
 * audited like any other change.
 */
export async function cancelItem(actor: Actor, orderItemId: string) {
  const item = await prisma.orderItem.findFirst({
    where: { id: orderItemId, order: { userId: actor.id } },
    select: { id: true, status: true },
  });
  if (!item) throw new NotFoundError();

  if (item.status !== "QUEUED") {
    throw new ValidationError(
      "This placement is already under way and can no longer be cancelled here."
    );
  }

  const { transitionItem } = await import("./item-status");
  return transitionItem(actor, orderItemId, "REJECTED", { note: "Cancelled by advertiser" });
}
