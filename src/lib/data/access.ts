import { isStaff, type Actor } from "./actor";

/**
 * The catalog gate.
 *
 * Nothing about the catalog — sites, search, facets, ordering — is visible
 * until an account exists *and* staff have approved it. This lives here rather
 * than in route handlers for the same reason tenant isolation does: one place,
 * no exceptions, and a new route cannot forget it.
 */

export class NotApprovedError extends Error {
  /**
   * Deliberately does NOT carry the status. Callers render one holding page for
   * PENDING and REJECTED alike — telling a rejected applicant why only teaches
   * a competitor how to pass on a second attempt.
   */
  constructor(message = "This account cannot access the catalog.") {
    super(message);
    this.name = "NotApprovedError";
  }
}

/** Staff bypass the gate: they are not buying, and they run the queue. */
export function isApproved(actor: Actor): boolean {
  return actor.approved || isStaff(actor);
}

/**
 * Throws unless the actor may see inventory. Every catalog, site-detail,
 * search and order path calls this.
 */
export function assertApproved(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor || !isApproved(actor)) throw new NotApprovedError();
}

/**
 * Where a signed-in but ungated user should be sent. One destination for every
 * non-approved state, so the redirect itself reveals nothing.
 */
export const HOLDING_PATH = "/pending";

/**
 * True when the actor should be held rather than shown the app.
 *
 * Takes the actor, so the caller never has to handle a status string — the
 * pending, rejected and suspended cases are already the same value by the time
 * they get here.
 */
export function needsHolding(actor: Actor): boolean {
  return !isApproved(actor);
}
