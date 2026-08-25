import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthRequiredError, isPricingAdmin, isStaff, type Actor } from "./actor";
import { HOLDING_PATH, assertApproved, needsHolding } from "./access";

/**
 * Resolves the signed-in actor, or null.
 *
 * Role *and* status are re-read from the database rather than trusted from the
 * JWT. That is what makes suspension immediate: revoking access takes effect on
 * the next request rather than when the token expires, and an approval opens
 * the catalog without the user signing in again.
 */
export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, status: true },
  });
  if (!user) return null;

  // The raw status is collapsed to a boolean here and never travels further.
  // PENDING, REJECTED and SUSPENDED are the same value from this point on, so
  // no page, payload or log downstream can tell them apart.
  const { status, ...rest } = user;
  return { ...rest, approved: status === "APPROVED" };
}

/**
 * For server components behind the catalog gate. Signed-out visitors go to
 * login; signed-in-but-not-approved visitors go to the holding page — one
 * destination for PENDING, REJECTED and SUSPENDED alike, so the redirect itself
 * gives nothing away.
 */
export async function requireApprovedPage(returnTo?: string): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }
  if (needsHolding(actor)) redirect(HOLDING_PATH);
  return actor;
}

/**
 * For route handlers behind the catalog gate. Throws NotApprovedError, which
 * the shared error translator turns into a 404 — the same answer an
 * unauthenticated caller gets, so status cannot be probed by comparing codes.
 */
export async function requireApprovedApi(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new AuthRequiredError();
  assertApproved(actor);
  return actor;
}

/** For server components: bounces to the login page, preserving where they were headed. */
export async function requireActorPage(returnTo?: string): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }
  return actor;
}

/** For route handlers: throws, so the handler can answer 401 without redirecting. */
export async function requireActorApi(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new AuthRequiredError();
  return actor;
}

/**
 * Admin gate for pages. Renders the 404 page for anyone who is not staff —
 * including signed-out visitors — so the existence of /admin is never confirmed
 * by the response. A 403 here would be an inventory of internal tooling.
 */
export async function requireAdminPage(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor || !isStaff(actor)) notFound();
  return actor;
}

/** Staff gate for route handlers. Callers answer 404, never 401 or 403. */
export async function requireAdminApi(): Promise<Actor | null> {
  const actor = await currentActor();
  if (!actor || !isStaff(actor)) return null;
  return actor;
}

/** Alias with the clearer name; both roles pass. */
export const requireStaffApi = requireAdminApi;

/**
 * ADMIN-only gate for the pricing screens. An EDITOR gets the 404 page, same as
 * an advertiser — PHASE4.md requires cost never reach them, enforced here and
 * again in the data layer rather than by hiding the link.
 */
export async function requirePricingAdminPage(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor || !isPricingAdmin(actor)) notFound();
  return actor;
}

export async function requirePricingAdminApi(): Promise<Actor | null> {
  const actor = await currentActor();
  if (!actor || !isPricingAdmin(actor)) return null;
  return actor;
}
