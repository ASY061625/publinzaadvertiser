import { prisma } from "@/lib/db";
import { createAdvertiser } from "@/lib/data/accounts";
import type { Actor } from "@/lib/data/actor";

/**
 * Creates an advertiser that can actually use the app.
 *
 * Signup now yields a PENDING account with no catalog or ordering access, which
 * is correct but makes every suite that is about something else fail on the
 * gate. This approves in the same step, so those suites keep testing what they
 * are for. The gate itself is covered by tests/gated-access.spec.ts, which
 * manages statuses deliberately.
 */
export async function makeApprovedAdvertiser(input: {
  email: string;
  password: string;
  name?: string | null;
  country?: string | null;
}): Promise<Actor> {
  const actor = await createAdvertiser(input);

  await prisma.user.update({
    where: { id: actor.id },
    data: { status: "APPROVED" },
  });

  return { ...actor, approved: true };
}
