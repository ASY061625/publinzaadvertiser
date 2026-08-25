import { timingSafeEqual } from "node:crypto";

/**
 * Shared secret for the cron routes. These endpoints cost money (metrics
 * lookups) and hit third-party sites (link checks), so an open endpoint is
 * both a billing and an abuse problem.
 *
 * Without CRON_SECRET set, the routes refuse rather than running unauthenticated
 * — failing closed is the right default for something that spends money.
 */
export function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret") ??
    "";

  const a = Buffer.from(secret, "utf8");
  const b = Buffer.from(header, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
