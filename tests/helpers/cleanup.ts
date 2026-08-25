import { prisma } from "@/lib/db";

/**
 * Removes every row belonging to the given users, in foreign-key-safe order.
 *
 * Kept in one place because the order matters and grows with each phase: Phase 5
 * added Invoice (a real FK to Order) and the wallet rows the ledger creates, and
 * four separate cleanup blocks silently started failing when they were missed.
 */
export async function purgeUsers(userIds: string[]) {
  if (userIds.length === 0) return;

  const orders = await prisma.order.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  // Money first: credit notes reference invoices, invoices reference orders.
  await prisma.creditNote.deleteMany({ where: { invoice: { userId: { in: userIds } } } });
  await prisma.invoice.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.processedWebhookEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.transaction.deleteMany({ where: { wallet: { userId: { in: userIds } } } });
  await prisma.transaction.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });

  // Then the order graph.
  await prisma.itemCorrespondence.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.itemStatusEvent.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.itemStatusEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  await prisma.cartLine.deleteMany({ where: { cart: { userId: { in: userIds } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.project.deleteMany({ where: { userId: { in: userIds } } });

  // Admin trails last, then the users themselves.
  await prisma.sitePriceHistory.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.adminAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.importLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.publisherNote.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/** Removes sites (and their dependents) matching a domain prefix. */
export async function purgeSitesByPrefix(prefix: string) {
  await prisma.categoryOnSite.deleteMany({ where: { site: { domain: { startsWith: prefix } } } });
  await prisma.sitePriceHistory.deleteMany({ where: { site: { domain: { startsWith: prefix } } } });
  await prisma.site.deleteMany({ where: { domain: { startsWith: prefix } } });
}
