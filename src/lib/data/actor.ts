import type { Role } from "@prisma/client";

// Who a request is acting as. Every function in the data-access layer takes one
// of these as its first argument — there is no way to call a scoped query
// without naming the actor it is scoped to.
export type Actor = {
  id: string;
  email: string;
  role: Role;
  /**
   * Whether this account may see the catalog. Deliberately a boolean and not
   * the UserStatus string.
   *
   * PENDING, REJECTED and SUSPENDED all collapse to `false` here, so nothing
   * downstream — a page, a serialised payload, a log line — can tell them
   * apart. Telling a rejected applicant they were rejected just teaches a
   * competitor how to pass on the second attempt, and keeping the raw status
   * off the actor makes that indistinguishability structural rather than
   * something each surface has to remember.
   *
   * Recomputed from the database on every request, so approval and suspension
   * both take effect on the next click rather than at token expiry.
   */
  approved: boolean;
};

/**
 * Thrown when a record does not exist *or* is not the actor's to see.
 *
 * Deliberately one error, not two. A separate "forbidden" case would let an
 * advertiser probe for the existence of other people's records by watching the
 * status code, so callers turn every one of these into a plain 404.
 */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/**
 * Internal staff: may reach /admin and drive the order queue. Both roles.
 */
export function isStaff(actor: Actor): boolean {
  return actor.role === "ADMIN" || actor.role === "EDITOR";
}

/**
 * ADMIN only. Gates everything that touches money we pay the publisher —
 * costCents, margin, pricing screens, catalog import.
 *
 * An EDITOR fulfils orders and must never see cost or margin (PHASE4.md), so
 * this is deliberately narrower than isStaff. Enforced at the data layer, not
 * by hiding buttons.
 */
export function isPricingAdmin(actor: Actor): boolean {
  return actor.role === "ADMIN";
}

/** @deprecated Ambiguous now that the two internal roles differ. Use isStaff or isPricingAdmin. */
export function isAdmin(actor: Actor): boolean {
  return isStaff(actor);
}
