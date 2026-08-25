import { NextResponse } from "next/server";
import { AuthRequiredError, NotFoundError, ValidationError } from "@/lib/data/actor";
import { NotApprovedError } from "@/lib/data/access";
import { TransitionError } from "@/lib/data/item-status";

/**
 * One translation from data-layer errors to HTTP, shared by every route
 * handler so no individual route can invent a different status.
 *
 * NotFoundError becomes 404 — never 403. The data layer already refuses to
 * distinguish "does not exist" from "not yours", and this keeps that
 * indistinguishable on the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof AuthRequiredError) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  // A refused status change is a conflict with the item's current state, not a
  // malformed request — 409 so callers can tell the two apart.
  if (err instanceof TransitionError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // An unapproved account gets the same 404 as a route that does not exist.
  // Anything more specific would let PENDING and REJECTED be told apart by
  // comparing status codes, which is exactly what GATED-ACCESS.md forbids.
  if (err instanceof NotApprovedError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  console.error("Unhandled API error", err);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404 });
