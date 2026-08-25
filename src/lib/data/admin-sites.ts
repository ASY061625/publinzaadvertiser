import type { ChannelType, LinkType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, isPricingAdmin, type Actor } from "./actor";
import { writeAudit } from "./audit";

/**
 * Site management. ADMIN only, throughout.
 *
 * Every function here starts with assertPricingAdmin: this module reads and
 * writes costCents, so an EDITOR must not reach any of it. NotFoundError rather
 * than a forbidden error, so the routes answer 404 and never confirm that the
 * pricing screens exist.
 *
 * There is deliberately no delete function. Existing OrderItem rows reference
 * Site and history has to stay intact — deactivate instead.
 */
function assertPricingAdmin(actor: Actor) {
  if (!isPricingAdmin(actor)) throw new NotFoundError();
}

export const SENSITIVE_TOPICS = ["casino", "crypto", "forex", "cbd", "adult", "dating"];

export type SiteInput = {
  domain?: string;
  country?: string;
  language?: string;
  description?: string | null;
  costCents?: number;
  priceCents?: number;
  writingCents?: number;
  turnaroundDays?: number;
  linkType?: LinkType;
  channelType?: ChannelType;
  maxLinks?: number;
  minWords?: number;
  guaranteeDays?: number;
  acceptsSensitive?: string[];
  publisherId?: string | null;
  isActive?: boolean;
};

export type MarginOptions = {
  /** Must be set deliberately to save a site whose price does not beat its cost. */
  override?: boolean;
  overrideReason?: string | null;
};

export function marginOf(priceCents: number, costCents: number) {
  const marginCents = priceCents - costCents;
  return {
    marginCents,
    marginPct: priceCents > 0 ? Math.round((marginCents / priceCents) * 100) : 0,
  };
}

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export function isValidDomain(value: string): boolean {
  // Accepts a bare host, or a Telegram/YouTube style channel path.
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 253 || /\s/.test(trimmed)) return false;
  if (trimmed.includes("/")) {
    const [host] = trimmed.split("/");
    return DOMAIN_RE.test(host);
  }
  return DOMAIN_RE.test(trimmed);
}

function validateCore(input: SiteInput, existing?: { costCents: number; priceCents: number }) {
  if (input.domain !== undefined && !isValidDomain(input.domain)) {
    throw new ValidationError(`"${input.domain}" is not a valid domain.`);
  }
  if (input.country !== undefined && !/^[A-Z]{2}$/.test(input.country)) {
    throw new ValidationError(`country must be an ISO-3166-1 alpha-2 code, got "${input.country}".`);
  }
  if (input.language !== undefined && !/^[a-z]{2}$/.test(input.language)) {
    throw new ValidationError(`language must be an ISO-639-1 code, got "${input.language}".`);
  }

  for (const field of ["costCents", "priceCents", "writingCents"] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationError(`${field} must be a non-negative whole number of cents.`);
    }
  }

  if (input.acceptsSensitive) {
    for (const topic of input.acceptsSensitive) {
      if (!SENSITIVE_TOPICS.includes(topic)) {
        throw new ValidationError(`"${topic}" is not a known restricted topic.`);
      }
    }
  }

  const cost = input.costCents ?? existing?.costCents;
  const price = input.priceCents ?? existing?.priceCents;
  return { cost, price };
}

/**
 * Selling at a loss should be a decision, not a typo — so it is blocked unless
 * the caller says so explicitly and gives a reason, which is then logged.
 */
function assertMargin(cost: number, price: number, options: MarginOptions) {
  if (price > cost) return null;

  if (!options.override) {
    const { marginCents } = marginOf(price, cost);
    throw new ValidationError(
      `Price must be above cost. That would be a margin of ${marginCents} cents. ` +
        `Tick the override and give a reason to save it anyway.`
    );
  }

  const reason = options.overrideReason?.trim();
  if (!reason) {
    throw new ValidationError("An override needs a reason, so the decision is on the record.");
  }
  return reason;
}

const ADMIN_SITE_SELECT = {
  id: true,
  domain: true,
  channelType: true,
  country: true,
  language: true,
  description: true,
  costCents: true,
  priceCents: true,
  writingCents: true,
  turnaroundDays: true,
  linkType: true,
  maxLinks: true,
  minWords: true,
  guaranteeDays: true,
  acceptsSensitive: true,
  isActive: true,
  isExclusive: true,
  publisherId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SiteSelect;

export async function listSitesAdmin(
  actor: Actor,
  filters: { q?: string | null; isActive?: boolean | null; publisherId?: string | null }
) {
  assertPricingAdmin(actor);

  const where: Prisma.SiteWhereInput = {};
  if (filters.q) where.domain = { contains: filters.q, mode: "insensitive" };
  if (filters.isActive !== null && filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.publisherId) where.publisherId = filters.publisherId;

  const rows = await prisma.site.findMany({
    where,
    select: {
      ...ADMIN_SITE_SELECT,
      publisher: { select: { id: true, name: true, reliability: true } },
    },
    orderBy: { domain: "asc" },
    take: 500,
  });

  return rows.map((r) => ({ ...r, ...marginOf(r.priceCents, r.costCents) }));
}

export async function getSiteForEdit(actor: Actor, siteId: string) {
  assertPricingAdmin(actor);

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      ...ADMIN_SITE_SELECT,
      // Reliability is shown on the edit screen so pricing decisions see it.
      publisher: {
        select: { id: true, name: true, reliability: true, onTimeRate: true, rejectionRate: true },
      },
      categories: { select: { category: { select: { slug: true, name: true } } } },
      priceHistory: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          oldCostCents: true,
          newCostCents: true,
          oldPriceCents: true,
          newPriceCents: true,
          overrideReason: true,
          createdAt: true,
          actor: { select: { email: true } },
        },
      },
    },
  });
  if (!site) throw new NotFoundError();

  return {
    ...site,
    ...marginOf(site.priceCents, site.costCents),
    categories: site.categories.map((c) => c.category),
  };
}

export async function createSite(actor: Actor, input: SiteInput) {
  assertPricingAdmin(actor);

  if (!input.domain) throw new ValidationError("A domain is required.");
  const { cost, price } = validateCore(input);
  if (cost === undefined || price === undefined) {
    throw new ValidationError("Both cost and price are required.");
  }
  assertMargin(cost, price, {});

  const domain = input.domain.trim().toLowerCase();
  const clash = await prisma.site.findUnique({ where: { domain }, select: { id: true } });
  if (clash) throw new ValidationError(`${domain} is already in the catalog.`);

  return prisma.$transaction(async (tx) => {
    const site = await tx.site.create({
      data: {
        domain,
        country: input.country!.toUpperCase(),
        language: input.language!.toLowerCase(),
        description: input.description ?? null,
        costCents: cost,
        priceCents: price,
        writingCents: input.writingCents ?? 0,
        turnaroundDays: input.turnaroundDays ?? 7,
        linkType: input.linkType ?? "DOFOLLOW",
        channelType: input.channelType ?? "WEBSITE",
        maxLinks: input.maxLinks ?? 2,
        minWords: input.minWords ?? 700,
        guaranteeDays: input.guaranteeDays ?? 90,
        acceptsSensitive: input.acceptsSensitive ?? [],
        publisherId: input.publisherId ?? null,
      },
      select: ADMIN_SITE_SELECT,
    });

    await writeAudit(tx, actor, {
      action: "site.create",
      entityType: "Site",
      entityId: site.id,
      before: null,
      after: site,
    });

    return site;
  });
}

export async function updateSite(
  actor: Actor,
  siteId: string,
  input: SiteInput,
  options: MarginOptions = {}
) {
  assertPricingAdmin(actor);

  const existing = await prisma.site.findUnique({ where: { id: siteId }, select: ADMIN_SITE_SELECT });
  if (!existing) throw new NotFoundError();

  const { cost, price } = validateCore(input, existing);
  const overrideReason = assertMargin(cost!, price!, options);

  const data: Prisma.SiteUpdateInput = {};
  if (input.domain !== undefined) data.domain = input.domain.trim().toLowerCase();
  if (input.country !== undefined) data.country = input.country.toUpperCase();
  if (input.language !== undefined) data.language = input.language.toLowerCase();
  if (input.description !== undefined) data.description = input.description;
  if (input.costCents !== undefined) data.costCents = input.costCents;
  if (input.priceCents !== undefined) data.priceCents = input.priceCents;
  if (input.writingCents !== undefined) data.writingCents = input.writingCents;
  if (input.turnaroundDays !== undefined) data.turnaroundDays = input.turnaroundDays;
  if (input.linkType !== undefined) data.linkType = input.linkType;
  if (input.channelType !== undefined) data.channelType = input.channelType;
  if (input.maxLinks !== undefined) data.maxLinks = input.maxLinks;
  if (input.minWords !== undefined) data.minWords = input.minWords;
  if (input.guaranteeDays !== undefined) data.guaranteeDays = input.guaranteeDays;
  if (input.acceptsSensitive !== undefined) data.acceptsSensitive = input.acceptsSensitive;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.publisherId !== undefined) {
    data.publisher = input.publisherId
      ? { connect: { id: input.publisherId } }
      : { disconnect: true };
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.site.update({
      where: { id: siteId },
      data,
      select: ADMIN_SITE_SELECT,
    });

    // Price history is written only when a number actually moved, so the log
    // stays a record of pricing decisions rather than of every save.
    const priceMoved =
      updated.costCents !== existing.costCents || updated.priceCents !== existing.priceCents;

    if (priceMoved) {
      await tx.sitePriceHistory.create({
        data: {
          siteId,
          oldCostCents: existing.costCents,
          newCostCents: updated.costCents,
          oldPriceCents: existing.priceCents,
          newPriceCents: updated.priceCents,
          actorUserId: actor.id,
          overrideReason,
        },
      });
    }

    await writeAudit(tx, actor, {
      action: "site.update",
      entityType: "Site",
      entityId: siteId,
      before: existing,
      after: updated,
    });

    return updated;
  });
}

/**
 * Removes a site from the catalog. This is the only "delete" there is: the row
 * stays so existing OrderItem rows keep resolving their domain and price.
 */
export async function deactivateSite(actor: Actor, siteId: string) {
  assertPricingAdmin(actor);

  const existing = await prisma.site.findUnique({ where: { id: siteId }, select: ADMIN_SITE_SELECT });
  if (!existing) throw new NotFoundError();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.site.update({
      where: { id: siteId },
      data: { isActive: false },
      select: ADMIN_SITE_SELECT,
    });

    await writeAudit(tx, actor, {
      action: "site.deactivate",
      entityType: "Site",
      entityId: siteId,
      before: existing,
      after: updated,
    });

    return updated;
  });
}

export async function reactivateSite(actor: Actor, siteId: string) {
  assertPricingAdmin(actor);

  const existing = await prisma.site.findUnique({ where: { id: siteId }, select: ADMIN_SITE_SELECT });
  if (!existing) throw new NotFoundError();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.site.update({
      where: { id: siteId },
      data: { isActive: true },
      select: ADMIN_SITE_SELECT,
    });

    await writeAudit(tx, actor, {
      action: "site.reactivate",
      entityType: "Site",
      entityId: siteId,
      before: existing,
      after: updated,
    });

    return updated;
  });
}
