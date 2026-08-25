import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  hashPassword,
  isValidEmail,
  normaliseEmail,
  validatePassword,
  verifyPassword,
} from "@/lib/auth/password";
import { ValidationError, type Actor } from "./actor";

export const RESET_TOKEN_TTL_MINUTES = 60;

export async function createAdvertiser(input: {
  email: string;
  password: string;
  name?: string | null;
  country?: string | null;
  // Signup review details. Something has to be reviewable, and an email address
  // on its own makes an approval decision a coin toss.
  companyName?: string | null;
  companyWebsite?: string | null;
  jobRole?: string | null;
  promoting?: string | null;
}): Promise<Actor> {
  const email = normaliseEmail(input.email);
  if (!isValidEmail(email)) throw new ValidationError("Enter a valid email address.");

  const passwordProblem = validatePassword(input.password);
  if (passwordProblem) throw new ValidationError(passwordProblem);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new ValidationError("That email is already registered.");

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name?.trim() || null,
      country: input.country?.trim()?.toUpperCase() || null,
      passwordHash: await hashPassword(input.password),
      role: "ADVERTISER", // Never taken from user input — no self-service escalation.
      // Same rule for status: an account is PENDING until a person approves it,
      // and nothing in the request body can change that.
      status: "PENDING",

      // Captured so the approval queue has something to judge. Optional at the
      // schema level because staff-created accounts do not go through signup.
      companyName: input.companyName?.trim() || null,
      companyWebsite: input.companyWebsite?.trim() || null,
      jobRole: input.jobRole?.trim() || null,
      promoting: input.promoting?.trim() || null,
    },
    select: { id: true, email: true, role: true },
  });

  // A new account is never approved, so this is a constant rather than a read.
  return { ...user, approved: false };
}

/** Returns null on both unknown email and wrong password, so neither is discoverable. */
export async function authenticate(email: string, password: string): Promise<Actor | null> {
  const user = await prisma.user.findUnique({
    where: { email: normaliseEmail(email) },
    select: { id: true, email: true, role: true, status: true, passwordHash: true },
  });

  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) return null;

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    approved: user.status === "APPROVED",
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Always resolves, whether or not the email exists — the caller shows the same
 * message either way, so this cannot be used to enumerate registered accounts.
 * The raw token is returned only when one was actually issued; it is never
 * stored, only its SHA-256.
 */
export async function requestPasswordReset(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email: normaliseEmail(email) },
    select: { id: true },
  });
  if (!user) return null;

  const token = randomBytes(32).toString("base64url");

  // Outstanding tokens are invalidated so a reset link cannot be reused after
  // a newer one is requested.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
    },
  });

  return token;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const problem = validatePassword(newPassword);
  if (problem) throw new ValidationError(problem);

  const candidate = hashToken(token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: candidate },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, tokenHash: true },
  });

  const stored = Buffer.from(record?.tokenHash ?? candidate, "hex");
  const supplied = Buffer.from(candidate, "hex");
  const matches =
    !!record && stored.length === supplied.length && timingSafeEqual(stored, supplied);

  if (!matches || record.usedAt || record.expiresAt < new Date()) {
    throw new ValidationError("That reset link is invalid or has expired.");
  }

  // Marking the token used and changing the password in one transaction, so a
  // failure cannot leave a spent link still usable.
  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
  ]);
}

export async function changePassword(
  actor: Actor,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const problem = validatePassword(newPassword);
  if (problem) throw new ValidationError(problem);

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { passwordHash: true },
  });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ValidationError("Current password is incorrect.");
  }

  await prisma.user.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}
