import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, isPricingAdmin, type Actor } from "./actor";

export type AuditAction =
  | "site.create"
  | "site.update"
  | "site.deactivate"
  | "site.reactivate"
  | "publisher.create"
  | "publisher.update"
  | "publisher.note"
  | "catalog.import"
  | "item.assign"
  | "item.correspondence"
  // Account approval decisions. "who approved this account" is the first
  // question asked when one turns out to be a competitor.
  | "account.approve"
  | "account.reject"
  | "account.suspend"
  | "account.reinstate";

export type AuditEntity = "Site" | "Publisher" | "OrderItem" | "Import" | "User";

/**
 * Writes one audit row. Always called with the surrounding transaction client
 * so the log and the change it describes commit together — a refused write
 * leaves no row behind, and a successful one can never be missing its record.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    action: AuditAction;
    entityType: AuditEntity;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  }
) {
  return tx.adminAuditLog.create({
    data: {
      actorUserId: actor.id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: (input.before ?? null) as Prisma.InputJsonValue,
      after: (input.after ?? null) as Prisma.InputJsonValue,
    },
  });
}

export type AuditFilters = {
  entityType?: AuditEntity | null;
  entityId?: string | null;
  action?: AuditAction | null;
  actorUserId?: string | null;
};

/**
 * Reading the log is ADMIN-only: it contains cost and margin in its before/after
 * snapshots, which an EDITOR must never see.
 */
export async function listAuditLog(actor: Actor, filters: AuditFilters) {
  if (!isPricingAdmin(actor)) throw new NotFoundError();

  const where: Prisma.AdminAuditLogWhereInput = {};
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.action) where.action = filters.action;
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;

  return prisma.adminAuditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
      actorUserId: true,
      createdAt: true,
      actor: { select: { email: true } },
    },
  });
}

/** Test and reporting helper; does not gate, so never expose it through a route. */
export async function countAuditRows(filters: AuditFilters): Promise<number> {
  const where: Prisma.AdminAuditLogWhereInput = {};
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.action) where.action = filters.action;
  return prisma.adminAuditLog.count({ where });
}
