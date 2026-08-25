import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, type Actor } from "./actor";

export type CartLineView = {
  id: string;
  siteId: string;
  domain: string;
  country: string;
  language: string;
  priceCents: number;
  writingCents: number;
  turnaroundDays: number;
  projectId: string;
  projectName: string;
  addedAt: Date;
};

export type CartView = {
  lines: CartLineView[];
  subtotalCents: number;
  /**
   * Site/project pairs appearing more than once. Legitimate occasionally,
   * usually a mistake — surfaced as a warning, never blocked.
   */
  duplicates: { siteId: string; domain: string; projectId: string; projectName: string; count: number }[];
};

/** The cart row is created on first use rather than at signup. */
async function ensureCart(actor: Actor): Promise<string> {
  const existing = await prisma.cart.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.cart.create({
    data: { userId: actor.id },
    select: { id: true },
  });
  return created.id;
}

export async function getCart(actor: Actor): Promise<CartView> {
  const cart = await prisma.cart.findUnique({
    where: { userId: actor.id },
    select: {
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          siteId: true,
          projectId: true,
          createdAt: true,
          // costCents is deliberately not selected — this view reaches an advertiser.
          site: {
            select: {
              domain: true,
              country: true,
              language: true,
              priceCents: true,
              writingCents: true,
              turnaroundDays: true,
            },
          },
          project: { select: { name: true } },
        },
      },
    },
  });

  const lines: CartLineView[] = (cart?.lines ?? []).map((l) => ({
    id: l.id,
    siteId: l.siteId,
    domain: l.site.domain,
    country: l.site.country,
    language: l.site.language,
    priceCents: l.site.priceCents,
    writingCents: l.site.writingCents,
    turnaroundDays: l.site.turnaroundDays,
    projectId: l.projectId,
    projectName: l.project.name,
    addedAt: l.createdAt,
  }));

  const seen = new Map<string, { line: CartLineView; count: number }>();
  for (const line of lines) {
    const key = `${line.siteId}::${line.projectId}`;
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { line, count: 1 });
  }

  const duplicates = [...seen.values()]
    .filter((v) => v.count > 1)
    .map((v) => ({
      siteId: v.line.siteId,
      domain: v.line.domain,
      projectId: v.line.projectId,
      projectName: v.line.projectName,
      count: v.count,
    }));

  return {
    lines,
    subtotalCents: lines.reduce((n, l) => n + l.priceCents, 0),
    duplicates,
  };
}

export async function addToCart(
  actor: Actor,
  input: { siteId: string; projectId: string }
): Promise<CartView> {
  // Both the project and the site are re-checked against the actor and the
  // live catalog, so neither id can be forged into the cart.
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: actor.id },
    select: { id: true },
  });
  if (!project) throw new NotFoundError();

  const site = await prisma.site.findFirst({
    where: { id: input.siteId, isActive: true },
    select: { id: true },
  });
  if (!site) throw new ValidationError("That site is no longer available.");

  const cartId = await ensureCart(actor);
  await prisma.cartLine.create({
    data: { cartId, siteId: site.id, projectId: project.id },
  });

  return getCart(actor);
}

export async function removeFromCart(actor: Actor, lineId: string): Promise<CartView> {
  const result = await prisma.cartLine.deleteMany({
    where: { id: lineId, cart: { userId: actor.id } },
  });
  if (result.count === 0) throw new NotFoundError();
  return getCart(actor);
}

export async function clearCart(actor: Actor): Promise<CartView> {
  await prisma.cartLine.deleteMany({ where: { cart: { userId: actor.id } } });
  return getCart(actor);
}
