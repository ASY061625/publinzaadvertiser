import type { UserStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, isStaff, type Actor } from "./actor";
import { writeAudit, type AuditAction } from "./audit";

/**
 * The account approval queue.
 *
 * Approval speed is a conversion metric: someone who signs up and waits three
 * days has already bought from a competitor. The queue is therefore sorted
 * oldest first, so the person who has waited longest is always at the top.
 *
 * Staff only — both roles, since an EDITOR can reasonably clear the queue and
 * nothing here touches cost.
 */
function assertStaff(actor: Actor) {
  if (!isStaff(actor)) throw new NotFoundError();
}

export type QueuedAccount = {
  id: string;
  email: string;
  name: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  jobRole: string | null;
  promoting: string | null;
  country: string | null;
  status: UserStatus;
  createdAt: Date;
  statusDecidedAt: Date | null;
  decidedByEmail: string | null;
  /** Free-email signups are the ones worth a closer look. */
  freeEmailDomain: boolean;
  waitingHours: number;
};

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "live.com", "aol.com", "icloud.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "yandex.com", "zoho.com",
]);

const SELECT = {
  id: true,
  email: true,
  name: true,
  companyName: true,
  companyWebsite: true,
  jobRole: true,
  promoting: true,
  country: true,
  status: true,
  createdAt: true,
  statusDecidedAt: true,
  statusDecidedBy: { select: { email: true } },
} as const;

const HOUR_MS = 60 * 60 * 1000;

function toQueued(row: {
  id: string;
  email: string;
  name: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  jobRole: string | null;
  promoting: string | null;
  country: string | null;
  status: UserStatus;
  createdAt: Date;
  statusDecidedAt: Date | null;
  statusDecidedBy: { email: string } | null;
}): QueuedAccount {
  const domain = row.email.split("@")[1]?.toLowerCase() ?? "";
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    companyName: row.companyName,
    companyWebsite: row.companyWebsite,
    jobRole: row.jobRole,
    promoting: row.promoting,
    country: row.country,
    status: row.status,
    createdAt: row.createdAt,
    statusDecidedAt: row.statusDecidedAt,
    decidedByEmail: row.statusDecidedBy?.email ?? null,
    freeEmailDomain: FREE_EMAIL_DOMAINS.has(domain),
    waitingHours: Math.max(0, Math.floor((Date.now() - row.createdAt.getTime()) / HOUR_MS)),
  };
}

export async function listPendingAccounts(actor: Actor): Promise<QueuedAccount[]> {
  assertStaff(actor);

  const rows = await prisma.user.findMany({
    where: { status: "PENDING", role: "ADVERTISER" },
    // Oldest first: the longest wait is the most urgent.
    orderBy: { createdAt: "asc" },
    take: 500,
    select: SELECT,
  });

  return rows.map(toQueued);
}

export async function listDecidedAccounts(
  actor: Actor,
  status: UserStatus
): Promise<QueuedAccount[]> {
  assertStaff(actor);

  const rows = await prisma.user.findMany({
    where: { status, role: "ADVERTISER" },
    orderBy: { statusDecidedAt: "desc" },
    take: 200,
    select: SELECT,
  });

  return rows.map(toQueued);
}

export type AccountDecision = "approve" | "reject" | "suspend" | "reinstate";

const TARGET_STATUS: Record<AccountDecision, UserStatus> = {
  approve: "APPROVED",
  reject: "REJECTED",
  suspend: "SUSPENDED",
  reinstate: "APPROVED",
};

const AUDIT_ACTION: Record<AccountDecision, AuditAction> = {
  approve: "account.approve",
  reject: "account.reject",
  suspend: "account.suspend",
  reinstate: "account.reinstate",
};

/**
 * Records a decision on one account.
 *
 * The status change, the denormalised decision fields and the audit row all
 * commit together — a decision that is not on the record may as well not have
 * been made, and "who approved this account" is the first question asked when
 * one turns out to be a competitor.
 */
export async function decideAccount(
  actor: Actor,
  userId: string,
  decision: AccountDecision,
  note?: string | null
) {
  assertStaff(actor);

  const target = TARGET_STATUS[decision];
  if (!target) throw new ValidationError(`Unknown decision "${decision}".`);

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, status: true, role: true },
  });
  if (!existing) throw new NotFoundError();

  // Staff accounts are not gated and must not be put through this queue —
  // suspending your own admin account by a stray click is not a good failure.
  if (existing.role !== "ADVERTISER") {
    throw new ValidationError("Only advertiser accounts go through the approval queue.");
  }
  if (existing.id === actor.id) {
    throw new ValidationError("You cannot decide on your own account.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        status: target,
        statusDecidedAt: new Date(),
        statusDecidedById: actor.id,
      },
      select: { id: true, email: true, status: true, statusDecidedAt: true },
    });

    await writeAudit(tx, actor, {
      action: AUDIT_ACTION[decision],
      entityType: "User",
      entityId: userId,
      before: { status: existing.status, email: existing.email },
      after: { status: updated.status, email: updated.email, note: note?.trim() || null },
    });

    return updated;
  });
}

export async function accountCounts(actor: Actor) {
  assertStaff(actor);

  const rows = await prisma.user.groupBy({
    by: ["status"],
    where: { role: "ADVERTISER" },
    _count: { _all: true },
  });

  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}
