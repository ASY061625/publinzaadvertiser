import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { expect } from "vitest";

export const BASE = process.env.CATALOG_BASE_URL || "http://localhost:3000";
export const TEST_PASSWORD = "correct-horse-battery";

/**
 * Minimal cookie jar, so each actor in a test keeps an independent session and
 * the flows exercised are the ones a browser would actually perform.
 */
export class Client {
  private cookies = new Map<string, string>();

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });

    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    return res;
  }

  async login(email: string, password: string): Promise<void> {
    const { csrfToken } = await (await this.fetch("/api/auth/csrf")).json();
    const body = new URLSearchParams({ email, password, csrfToken, callbackUrl: BASE });
    const res = await this.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect([200, 302]).toContain(res.status);
  }

  /**
   * Signs up, and by default approves the account.
   *
   * Every account now starts PENDING and cannot see the catalog or order until
   * staff approve it. Almost every suite is about something else and just needs
   * a working advertiser, so approval is the default here and the gating spec
   * passes `{ approved: false }` when the pending state is the point.
   */
  async signup(
    email: string,
    password = TEST_PASSWORD,
    options: { approved?: boolean } = {}
  ): Promise<void> {
    const res = await this.fetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    expect(res.status, `signup ${email}`).toBe(201);

    if (options.approved !== false) {
      const { prisma } = await import("@/lib/db");
      await prisma.user.update({ where: { email }, data: { status: "APPROVED" } });
    }
  }

  /** Signed-out sessions come back as a bare `null`, not an object. */
  async session(): Promise<{ user?: { id: string; role: string; email: string } }> {
    return (await (await this.fetch("/api/auth/session")).json()) ?? {};
  }

  /** The jar as a Cookie header, for callers that use a bare fetch. */
  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  setCookie(name: string, value: string) {
    this.cookies.set(name, value);
  }

  clearCookies() {
    this.cookies.clear();
  }
}

/**
 * Walks the app directory for real route files instead of listing paths by hand.
 *
 * This is what makes "every /admin route" a claim the tests can actually back:
 * an admin route added later is picked up automatically and must pass the same
 * guard assertions, rather than quietly going untested.
 */
function walk(dir: string, found: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (entry === "route.ts" || entry === "page.tsx") found.push(full);
  }
  return found;
}

/** Turns a file path under src/app into the URL it serves. */
function toUrlPath(file: string): string {
  const parts = file.split(sep);
  const appIdx = parts.lastIndexOf("app");
  const segments = parts
    .slice(appIdx + 1, -1)
    // (auth) and similar route groups do not appear in the URL.
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  return "/" + segments.join("/");
}

/** True when a discovered path still contains a dynamic segment like [id]. */
export function isDynamic(route: string): boolean {
  return route.includes("[");
}

/**
 * Replaces dynamic segments with a placeholder so the route's handler actually
 * runs. A fabricated id is expected to 404 from the handler — that is fine; the
 * point is to exercise the guard rather than Next's path matcher.
 */
export function fillDynamic(route: string, value = "probe-nonexistent-id"): string {
  return route.replace(/\[\.\.\.[^\]]+\]/g, value).replace(/\[[^\]]+\]/g, value);
}

export function discoverRoutes(appDir: string): { pages: string[]; apis: string[] } {
  const files = walk(appDir);
  const pages: string[] = [];
  const apis: string[] = [];

  for (const file of files) {
    const url = toUrlPath(file);
    if (url.includes("[...")) continue; // catch-alls are exercised by name elsewhere
    (file.endsWith("route.ts") ? apis : pages).push(url);
  }
  return { pages: [...new Set(pages)].sort(), apis: [...new Set(apis)].sort() };
}

export function adminRoutes(appDir: string): string[] {
  const { pages, apis } = discoverRoutes(appDir);
  return [...pages, ...apis].filter((p) => p === "/admin" || p.startsWith("/admin/") || p.startsWith("/api/admin"));
}

/**
 * A signed-in, approved advertiser session as a raw Cookie header.
 *
 * The catalog is no longer public, so the Phase 1 specs — which fetch
 * /api/sites with a bare `fetch` — need a session. This gives them one without
 * restructuring them around the Client class.
 */
export async function approvedSessionCookie(tag = "catalog"): Promise<string> {
  const client = new Client();
  const email = `${tag}-reader-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

  await client.signup(email);
  await client.login(email, TEST_PASSWORD);

  return client.cookieHeader();
}
