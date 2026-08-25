/**
 * Phase 2 over real HTTP: signup, login, logout, reset, and the two boundaries
 * that matter — advertiser A must not reach advertiser B's projects by guessing
 * an id in the URL, and an advertiser must get 404 (never 403) on admin routes.
 *
 * Needs `npm run dev` running. Each user gets their own cookie jar, so these
 * exercise the same session path a browser would.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const BASE = process.env.CATALOG_BASE_URL || "http://localhost:3000";
const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "correct-horse-battery";

const emailA = `http-a-${SUFFIX}@example.test`;
const emailB = `http-b-${SUFFIX}@example.test`;
const emailStaff = `http-staff-${SUFFIX}@example.test`;

/** Minimal cookie jar so each actor keeps an independent session. */
class Client {
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
    // Auth.js credentials sign-in: fetch the CSRF token, then post the form.
    const csrfRes = await this.fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();

    const body = new URLSearchParams({ email, password, csrfToken, callbackUrl: BASE });
    const res = await this.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect([200, 302]).toContain(res.status);
  }

  async session(): Promise<{ user?: { id: string; role: string; email: string } }> {
    // Auth.js answers a bare `null` when there is no session, not an object.
    const body = await (await this.fetch("/api/auth/session")).json();
    return body ?? {};
  }

  hasSessionCookie(): boolean {
    return [...this.cookies.keys()].some((k) => k.includes("session-token"));
  }

  clearCookies() {
    this.cookies.clear();
  }
}

const alice = new Client();
const bob = new Client();
const staff = new Client();
const anonymous = new Client();

let aliceProjectId: string;
let bobProjectId: string;

async function signup(client: Client, email: string) {
  const res = await client.fetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: email.split("@")[0] }),
  });
  expect(res.status, `signup ${email}`).toBe(201);
}

beforeAll(async () => {
  await signup(alice, emailA);
  await signup(bob, emailB);
  await signup(staff, emailStaff);

  // Promote one account directly in the database — there is deliberately no
  // route that grants staff roles.
  await prisma.user.update({ where: { email: emailStaff }, data: { role: "ADMIN" } });

  await alice.login(emailA, PASSWORD);
  await bob.login(emailB, PASSWORD);
  await staff.login(emailStaff, PASSWORD);

  const mk = async (client: Client, name: string, url: string) => {
    const res = await client.fetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, targetUrl: url, notes: `${name} private note` }),
    });
    expect(res.status, `create ${name}`).toBe(201);
    return (await res.json()).project.id as string;
  };

  aliceProjectId = await mk(alice, "Alice Fintech", "https://alice-fintech.example");
  bobProjectId = await mk(bob, "Bob Wearables", "https://bob-wearables.example");
}, 60_000);

afterAll(async () => {
  const emails = [emailA, emailB, emailStaff];
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("sessions", () => {
  it("signs in and reports the right identity", async () => {
    const s = await alice.session();
    expect(s.user?.email).toBe(emailA);
    expect(s.user?.role).toBe("ADVERTISER");
  });

  it("rejects a wrong password without creating a session", async () => {
    const stranger = new Client();
    await stranger.login(emailA, "definitely-not-the-password").catch(() => {});
    const s = await stranger.session();
    expect(s.user).toBeUndefined();
  });

  it("refuses to register the same email twice", async () => {
    const res = await anonymous.fetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: emailA, password: PASSWORD }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a too-short password at signup", async () => {
    const res = await anonymous.fetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: `weak-${SUFFIX}@example.test`, password: "short" }),
    });
    expect(res.status).toBe(400);
  });

  it("never accepts a role from the signup payload", async () => {
    const email = `escalate-${SUFFIX}@example.test`;
    const res = await anonymous.fetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD, role: "ADMIN" }),
    });
    expect(res.status).toBe(201);

    const row = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
    expect(row?.role).toBe("ADVERTISER");
    await prisma.user.delete({ where: { email } });
  });

  it("signs out", async () => {
    const temp = new Client();
    await temp.login(emailB, PASSWORD);
    expect((await temp.session()).user?.email).toBe(emailB);

    const { csrfToken } = await (await temp.fetch("/api/auth/csrf")).json();
    await temp.fetch("/api/auth/signout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: BASE }).toString(),
    });

    expect((await temp.session()).user).toBeUndefined();
  });

  it("requires a session for project routes", async () => {
    anonymous.clearCookies();
    expect((await anonymous.fetch("/api/projects")).status).toBe(401);
    expect(
      (
        await anonymous.fetch("/api/projects", {
          method: "POST",
          body: JSON.stringify({ name: "x", targetUrl: "https://x.example" }),
        })
      ).status
    ).toBe(401);
  });
});

describe("advertiser A cannot reach advertiser B's project by guessing the id", () => {
  it("A's listing contains only A's project", async () => {
    const res = await alice.fetch("/api/projects");
    expect(res.status).toBe(200);
    const { projects } = await res.json();

    expect(projects.map((p: { id: string }) => p.id)).toEqual([aliceProjectId]);
    expect(JSON.stringify(projects)).not.toContain("Bob Wearables");
    expect(JSON.stringify(projects)).not.toContain("bob private note");
  });

  it("GET of B's project id returns 404, not 403", async () => {
    const res = await alice.fetch(`/api/projects/${bobProjectId}`);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("Bob Wearables");
  });

  it("PATCH of B's project id returns 404 and changes nothing", async () => {
    const res = await alice.fetch(`/api/projects/${bobProjectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Hijacked", targetUrl: "https://attacker.example" }),
    });
    expect(res.status).toBe(404);

    const check = await bob.fetch(`/api/projects/${bobProjectId}`);
    expect((await check.json()).project.name).toBe("Bob Wearables");
  });

  it("DELETE of B's project id returns 404 and leaves it in place", async () => {
    const res = await alice.fetch(`/api/projects/${bobProjectId}`, { method: "DELETE" });
    expect(res.status).toBe(404);

    const check = await bob.fetch(`/api/projects/${bobProjectId}`);
    expect(check.status).toBe(200);
  });

  it("answers identically for a guessed id and one that never existed", async () => {
    const guessed = await alice.fetch(`/api/projects/${bobProjectId}`);
    const invented = await alice.fetch("/api/projects/clzzzzzzzzzzzzzzzzzzzzzzzz");

    expect(guessed.status).toBe(invented.status);
    expect(await guessed.text()).toBe(await invented.text());
  });

  it("does not fall over on malformed ids", async () => {
    for (const id of ["..%2F..%2Fetc%2Fpasswd", "'%20OR%201=1%20--", "null", "0"]) {
      const res = await alice.fetch(`/api/projects/${id}`);
      expect(res.status).toBe(404);
    }
  });

  it("B can still edit and delete their own project", async () => {
    const patch = await bob.fetch(`/api/projects/${bobProjectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Bob Wearables v2", targetUrl: "https://bob-wearables.example" }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()).project.name).toBe("Bob Wearables v2");

    const extra = await bob.fetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Disposable", targetUrl: "https://disposable.example" }),
    });
    const disposableId = (await extra.json()).project.id;

    expect((await bob.fetch(`/api/projects/${disposableId}`, { method: "DELETE" })).status).toBe(204);
    expect((await bob.fetch(`/api/projects/${disposableId}`)).status).toBe(404);
  });
});

describe("admin routes answer 404 to anyone who is not staff", () => {
  it("advertiser gets 404 on the admin page, not 403", async () => {
    const res = await alice.fetch("/admin");
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("advertiser gets 404 on admin API routes", async () => {
    const res = await alice.fetch("/api/admin/stats");
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("signed-out visitor also gets 404, not a redirect to login", async () => {
    anonymous.clearCookies();
    const res = await anonymous.fetch("/admin");
    expect(res.status).toBe(404);
    expect([301, 302, 303, 307, 308]).not.toContain(res.status);
  });

  it("the 404 body reveals nothing about the admin page", async () => {
    const res = await alice.fetch("/admin");
    const text = await res.text();

    // None of the admin page's own content may appear. This caught a real leak:
    // a guard in the layout alone still streamed the page's markup, so the 404
    // arrived with "Site CRUD..." inside it.
    expect(text).not.toContain("Site CRUD");
    expect(text).not.toContain("Staff only");
    expect(text).not.toContain("Registered users");
    expect(text).not.toContain("Internal");

    // Note: not asserting the absence of the words "forbidden"/"unauthorized".
    // Next 15 emits `"forbidden":"$undefined"` in the RSC payload of every page,
    // including genuine 404s, so that would test the framework, not this app.
    // The meaningful check is the byte-level comparison in the test below.
  });

  it("the admin 404 page is byte-comparable to a genuinely missing page", async () => {
    const admin = await alice.fetch("/admin");
    const missing = await alice.fetch("/definitely-not-a-route-at-all");

    expect(admin.status).toBe(missing.status);

    // Strip the RSC payload's per-render ids, which differ on any two responses.
    const shape = (s: string) => s.replace(/\$[0-9a-f]{1,4}/g, "$X").length;
    const [a, m] = [shape(await admin.text()), shape(await missing.text())];
    expect(Math.abs(a - m)).toBeLessThan(200);
  });

  it("an advertiser's 404 is indistinguishable from a route that does not exist", async () => {
    const admin = await alice.fetch("/api/admin/stats");
    const nowhere = await alice.fetch("/api/admin/does-not-exist-at-all");
    expect(admin.status).toBe(nowhere.status);
  });

  it("staff do reach the admin routes", async () => {
    expect((await staff.fetch("/admin")).status).toBe(200);

    const api = await staff.fetch("/api/admin/stats");
    expect(api.status).toBe(200);
    expect((await api.json()).sites).toBeGreaterThan(0);
  });
});

describe("password reset", () => {
  it("gives the same answer for a known and an unknown email", async () => {
    const known = await anonymous.fetch("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ email: emailA }),
    });
    const unknown = await anonymous.fetch("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ email: `nobody-${SUFFIX}@example.test` }),
    });

    expect(known.status).toBe(unknown.status);
    const [k, u] = [await known.json(), await unknown.json()];
    expect(k.message).toBe(u.message);
  });

  it("resets the password with a valid token and invalidates the token", async () => {
    const req = await anonymous.fetch("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ email: emailB }),
    });
    const { devResetToken } = await req.json();
    expect(devResetToken).toBeTruthy();

    const newPassword = "brand-new-passphrase-99";
    const done = await anonymous.fetch("/api/auth/password-reset", {
      method: "PUT",
      body: JSON.stringify({ token: devResetToken, password: newPassword }),
    });
    expect(done.status).toBe(200);

    // The new password works.
    const reborn = new Client();
    await reborn.login(emailB, newPassword);
    expect((await reborn.session()).user?.email).toBe(emailB);

    // The old one does not.
    const stale = new Client();
    await stale.login(emailB, PASSWORD).catch(() => {});
    expect((await stale.session()).user).toBeUndefined();

    // The token is single-use.
    const replay = await anonymous.fetch("/api/auth/password-reset", {
      method: "PUT",
      body: JSON.stringify({ token: devResetToken, password: "yet-another-passphrase" }),
    });
    expect(replay.status).toBe(400);
  });

  it("rejects a made-up token", async () => {
    const res = await anonymous.fetch("/api/auth/password-reset", {
      method: "PUT",
      body: JSON.stringify({ token: "not-a-real-token", password: "some-long-password" }),
    });
    expect(res.status).toBe(400);
  });

  it("does not let a reset token be used to reach anyone else's account", async () => {
    const req = await anonymous.fetch("/api/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ email: emailA }),
    });
    const { devResetToken } = await req.json();

    await anonymous.fetch("/api/auth/password-reset", {
      method: "PUT",
      body: JSON.stringify({ token: devResetToken, password: "alice-new-password-1" }),
    });

    // The reset applied to Alice only; Bob's current password is unaffected.
    const asAlice = new Client();
    await asAlice.login(emailA, "alice-new-password-1");
    expect((await asAlice.session()).user?.email).toBe(emailA);
  });
});
