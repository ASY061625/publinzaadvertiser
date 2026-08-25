import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, isPricingAdmin, isStaff, type Actor } from "./actor";
import { writeAudit } from "./audit";
import { computeReliability, recomputeAndStore } from "./reliability";

/**
 * Publisher records. Never reachable from an advertiser route — the whole
 * business model depends on advertisers not learning who owns which site
 * (CLAUDE.md rule 5).
 *
 * Reading is open to staff, because an EDITOR needs contact details for the
 * placements they are fulfilling. Writing, and payout notes, are ADMIN only.
 */
function assertStaff(actor: Actor) {
  if (!isStaff(actor)) throw new NotFoundError();
}

function assertPricingAdmin(actor: Actor) {
  if (!isPricingAdmin(actor)) throw new NotFoundError();
}

export type PublisherInput = {
  name?: string;
  email?: string | null;
  telegram?: string | null;
  payoutNotes?: string | null;
};

const BASE_SELECT = {
  id: true,
  name: true,
  email: true,
  telegram: true,
  reliability: true,
  onTimeRate: true,
  rejectionRate: true,
  avgDaysOverQuoted: true,
  deadLinkCount: true,
  reliabilityComputedAt: true,
  createdAt: true,
} satisfies Prisma.PublisherSelect;

/** Payout notes are commercial terms — ADMIN only, so the select depends on role. */
function selectFor(actor: Actor) {
  return isPricingAdmin(actor) ? { ...BASE_SELECT, payoutNotes: true } : BASE_SELECT;
}

function validate(input: PublisherInput) {
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ValidationError("A publisher needs a name.");
    if (name.length > 200) throw new ValidationError("That name is too long.");
  }
  if (input.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new ValidationError("That publisher email is not valid.");
    }
  }
}

export async function listPublishers(actor: Actor, filters: { q?: string | null } = {}) {
  assertStaff(actor);

  const where: Prisma.PublisherWhereInput = {};
  if (filters.q) where.name = { contains: filters.q, mode: "insensitive" };

  return prisma.publisher.findMany({
    where,
    select: { ...selectFor(actor), _count: { select: { sites: true } } },
    orderBy: { name: "asc" },
    take: 500,
  });
}

export async function getPublisher(actor: Actor, publisherId: string) {
  assertStaff(actor);

  const publisher = await prisma.publisher.findUnique({
    where: { id: publisherId },
    select: {
      ...selectFor(actor),
      sites: {
        select: { id: true, domain: true, isActive: true },
        orderBy: { domain: "asc" },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          body: true,
          createdAt: true,
          actor: { select: { email: true } },
        },
      },
    },
  });
  if (!publisher) throw new NotFoundError();

  return publisher;
}

export async function createPublisher(actor: Actor, input: PublisherInput) {
  assertPricingAdmin(actor);
  validate(input);

  if (!input.name?.trim()) throw new ValidationError("A publisher needs a name.");

  return prisma.$transaction(async (tx) => {
    const publisher = await tx.publisher.create({
      data: {
        name: input.name!.trim(),
        email: input.email?.trim() || null,
        telegram: input.telegram?.trim() || null,
        payoutNotes: input.payoutNotes?.trim() || null,
      },
      select: { ...BASE_SELECT, payoutNotes: true },
    });

    await writeAudit(tx, actor, {
      action: "publisher.create",
      entityType: "Publisher",
      entityId: publisher.id,
      before: null,
      after: publisher,
    });

    return publisher;
  });
}

export async function updatePublisher(actor: Actor, publisherId: string, input: PublisherInput) {
  assertPricingAdmin(actor);
  validate(input);

  const existing = await prisma.publisher.findUnique({
    where: { id: publisherId },
    select: { ...BASE_SELECT, payoutNotes: true },
  });
  if (!existing) throw new NotFoundError();

  const data: Prisma.PublisherUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.email !== undefined) data.email = input.email?.trim() || null;
  if (input.telegram !== undefined) data.telegram = input.telegram?.trim() || null;
  if (input.payoutNotes !== undefined) data.payoutNotes = input.payoutNotes?.trim() || null;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.publisher.update({
      where: { id: publisherId },
      data,
      select: { ...BASE_SELECT, payoutNotes: true },
    });

    await writeAudit(tx, actor, {
      action: "publisher.update",
      entityType: "Publisher",
      entityId: publisherId,
      before: existing,
      after: updated,
    });

    return updated;
  });
}

/** Free-text correspondence log. Staff may add, since editors do the chasing. */
export async function addPublisherNote(actor: Actor, publisherId: string, body: string) {
  assertStaff(actor);

  const trimmed = body?.trim() ?? "";
  if (!trimmed) throw new ValidationError("A note needs some text.");
  if (trimmed.length > 5000) throw new ValidationError("That note is too long.");

  const publisher = await prisma.publisher.findUnique({
    where: { id: publisherId },
    select: { id: true },
  });
  if (!publisher) throw new NotFoundError();

  return prisma.$transaction(async (tx) => {
    const note = await tx.publisherNote.create({
      data: { publisherId, body: trimmed, actorUserId: actor.id },
      select: { id: true, body: true, createdAt: true },
    });

    await writeAudit(tx, actor, {
      action: "publisher.note",
      entityType: "Publisher",
      entityId: publisherId,
      before: null,
      after: note,
    });

    return note;
  });
}

/** Recompute on demand. Also runs automatically after every item status change. */
export async function recomputeReliability(publisherId: string) {
  return recomputeAndStore(publisherId);
}

export async function previewReliability(actor: Actor, publisherId: string) {
  assertStaff(actor);
  return computeReliability(publisherId);
}
