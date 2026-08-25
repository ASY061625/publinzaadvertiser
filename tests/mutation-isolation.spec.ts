/**
 * Proves two things exhaustively, over real HTTP:
 *
 *   1. User B cannot edit or delete user A's project through any route or
 *      endpoint — every mutating method, every id-bearing path, and the
 *      side channels (payload-supplied ids, the project cookie, method
 *      overrides). Each attempt is followed by a check that A's row is
 *      byte-for-byte unchanged.
 *   2. A non-admin gets 404 on every /admin route. The route list is read off
 *      the filesystem, so a new admin route added later is covered without
 *      anyone remembering to add it here.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { prisma } from "@/lib/db";
import {
  BASE,
  Client,
  TEST_PASSWORD,
  adminRoutes,
  discoverRoutes,
  fillDynamic,
  isDynamic,
} from "./helpers/client";

const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailA = `mut-a-${SUFFIX}@example.test`;
const emailB = `mut-b-${SUFFIX}@example.test`;
const emailStaff = `mut-staff-${SUFFIX}@example.test`;

const alice = new Client();
const bob = new Client();
const staff = new Client();
const anon = new Client();

type Snapshot = {
  id: string;
  name: string;
  targetUrl: string;
  notes: string | null;
  userId: string;
};

let aliceProjectId: string;
let bobProjectId: string;
let pristine: Snapshot;

/** Reads straight from the database, bypassing any route that might be lying. */
async function snapshot(id: string): Promise<Snapshot | null> {
  return prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, targetUrl: true, notes: true, userId: true },
  });
}

async function expectAliceUntouched(afterWhat: string) {
  const now = await snapshot(aliceProjectId);
  expect(now, `Alice's project vanished after ${afterWhat}`).not.toBeNull();
  expect(now, `Alice's project was modified by ${afterWhat}`).toEqual(pristine);
}

beforeAll(async () => {
  await alice.signup(emailA);
  await bob.signup(emailB);
  await staff.signup(emailStaff);
  await prisma.user.update({ where: { email: emailStaff }, data: { role: "ADMIN" } });

  await alice.login(emailA, TEST_PASSWORD);
  await bob.login(emailB, TEST_PASSWORD);
  await staff.login(emailStaff, TEST_PASSWORD);

  const mk = async (client: Client, name: string, url: string) => {
    const res = await client.fetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, targetUrl: url, notes: `${name} confidential` }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).project.id as string;
  };

  aliceProjectId = await mk(alice, "Alice Primary", "https://alice-primary.example");
  bobProjectId = await mk(bob, "Bob Primary", "https://bob-primary.example");

  pristine = (await snapshot(aliceProjectId))!;
}, 60_000);

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { in: [emailA, emailB, emailStaff] } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

/* ───────────────────────  B CANNOT MUTATE A'S PROJECT  ─────────────────────── */

const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

describe("user B cannot edit user A's project through any method", () => {
  it.each(MUTATING_METHODS)("%s /api/projects/:aliceId is refused", async (method) => {
    const res = await bob.fetch(`/api/projects/${aliceProjectId}`, {
      method,
      body: JSON.stringify({
        name: "Hijacked by B",
        targetUrl: "https://attacker.example",
        notes: "owned",
      }),
    });

    // 404 where the handler exists, 405 where the method is not implemented.
    // Neither may be 200/204, and neither may change anything.
    expect([404, 405]).toContain(res.status);
    expect(res.status).not.toBe(403);
    await expectAliceUntouched(`${method} /api/projects/:id`);
  });

  it("DELETE of A's project is refused and the row survives", async () => {
    const res = await bob.fetch(`/api/projects/${aliceProjectId}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    await expectAliceUntouched("DELETE");
  });

  it("HEAD of A's project reveals nothing", async () => {
    const mine = await bob.fetch(`/api/projects/${bobProjectId}`, { method: "HEAD" });
    const theirs = await bob.fetch(`/api/projects/${aliceProjectId}`, { method: "HEAD" });
    expect(theirs.status).not.toBe(mine.status);
    expect(theirs.status).toBe(404);
  });

  it("a method-override header does not smuggle a mutation through", async () => {
    for (const header of ["x-http-method-override", "x-method-override", "_method"]) {
      const res = await bob.fetch(`/api/projects/${aliceProjectId}`, {
        method: "POST",
        headers: { [header]: "PATCH" },
        body: JSON.stringify({ name: "Overridden", targetUrl: "https://attacker.example" }),
      });
      expect([404, 405]).toContain(res.status);
    }
    await expectAliceUntouched("method override headers");
  });

  it("cannot reassign A's project to B by sending userId in the payload", async () => {
    const res = await bob.fetch(`/api/projects/${aliceProjectId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Stolen",
        targetUrl: "https://attacker.example",
        userId: (await bob.session()).user!.id,
      }),
    });
    expect(res.status).toBe(404);
    await expectAliceUntouched("payload userId on PATCH");
  });

  it("cannot claim A's project by sending its id when creating", async () => {
    const res = await bob.fetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        id: aliceProjectId,
        name: "Overwrite Attempt",
        targetUrl: "https://attacker.example",
      }),
    });
    // Creating is allowed; overwriting A's row through it is not.
    expect([200, 201]).toContain(res.status);
    const created = (await res.json()).project;
    expect(created.id).not.toBe(aliceProjectId);
    await expectAliceUntouched("POST with a supplied id");

    await bob.fetch(`/api/projects/${created.id}`, { method: "DELETE" });
  });

  it("cannot mutate A's project via a trailing-slash or encoded path variant", async () => {
    const variants = [
      `/api/projects/${aliceProjectId}/`,
      `/api/projects/${encodeURIComponent(aliceProjectId)}`,
      `/api/projects/${aliceProjectId}%20`,
      `/api/projects/${aliceProjectId.toUpperCase()}`,
    ];
    for (const path of variants) {
      const res = await bob.fetch(path, {
        method: "PATCH",
        body: JSON.stringify({ name: "Variant", targetUrl: "https://attacker.example" }),
      });
      expect([404, 405, 308]).toContain(res.status);
    }
    await expectAliceUntouched("path variants");
  });

  it("pointing the project cookie at A's project does not expose or alter it", async () => {
    bob.setCookie("outpost_project", aliceProjectId);

    const projectsPage = await bob.fetch("/projects");
    const catalogPage = await bob.fetch("/");
    const listing = await bob.fetch("/api/projects");

    for (const res of [projectsPage, catalogPage]) {
      const body = await res.text();
      expect(body).not.toContain("Alice Primary");
      expect(body).not.toContain("alice-primary.example");
      expect(body).not.toContain("Alice Primary confidential");
    }

    const { projects } = await listing.json();
    expect(projects.map((p: { id: string }) => p.id)).toEqual([bobProjectId]);
    await expectAliceUntouched("forged project cookie");

    bob.setCookie("outpost_project", bobProjectId);
  });

  it("a signed-out caller cannot mutate either project", async () => {
    anon.clearCookies();
    for (const method of MUTATING_METHODS) {
      const res = await anon.fetch(`/api/projects/${aliceProjectId}`, {
        method,
        body: JSON.stringify({ name: "Anon", targetUrl: "https://attacker.example" }),
      });
      expect([401, 404, 405]).toContain(res.status);
      expect(res.status).not.toBe(200);
    }
    await expectAliceUntouched("anonymous mutation attempts");
  });

  it("staff cannot mutate an advertiser's project through the advertiser API either", async () => {
    // Being ADMIN grants /admin, not ownership of someone's project row.
    const res = await staff.fetch(`/api/projects/${aliceProjectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Admin edit", targetUrl: "https://admin.example" }),
    });
    expect(res.status).toBe(404);
    await expectAliceUntouched("staff PATCH");

    expect((await staff.fetch(`/api/projects/${aliceProjectId}`, { method: "DELETE" })).status).toBe(404);
    await expectAliceUntouched("staff DELETE");
  });

  it("A can still edit and delete their own project after all of that", async () => {
    const patch = await alice.fetch(`/api/projects/${aliceProjectId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Alice Primary v2",
        targetUrl: "https://alice-primary.example",
        notes: "Alice Primary confidential",
      }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()).project.name).toBe("Alice Primary v2");

    // Keep the snapshot in step for any assertions that follow.
    pristine = (await snapshot(aliceProjectId))!;
  });
});

/* ─────────────────────  EVERY ADMIN ROUTE 404s FOR NON-ADMINS  ───────────────────── */

const ADMIN_ROUTES = adminRoutes(APP_DIR);

describe("every /admin route 404s for a non-admin", () => {
  it("found admin routes to test", () => {
    // Guards against the discovery silently returning nothing, which would make
    // every test below vacuously pass.
    expect(ADMIN_ROUTES.length).toBeGreaterThan(0);
    expect(ADMIN_ROUTES).toContain("/admin");
    expect(ADMIN_ROUTES).toContain("/api/admin/stats");
  });

  it.each(ADMIN_ROUTES)("advertiser gets 404 on %s", async (route) => {
    const res = await alice.fetch(route);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it.each(ADMIN_ROUTES)("signed-out visitor gets 404 on %s", async (route) => {
    anon.clearCookies();
    const res = await anon.fetch(route);
    expect(res.status).toBe(404);
    expect([301, 302, 303, 307, 308]).not.toContain(res.status);
  });

  it.each(ADMIN_ROUTES)("advertiser gets 404 on %s for every method", async (route) => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      const res = await alice.fetch(route, {
        method,
        ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify({}) }),
      });
      expect([404, 405], `${method} ${route}`).toContain(res.status);
      expect(res.status).not.toBe(403);
    }
  });

  it.each(ADMIN_ROUTES)("no admin content leaks in the 404 body of %s", async (route) => {
    const res = await alice.fetch(route);
    const body = await res.text();
    for (const secret of ["Site CRUD", "Staff only", "Registered users", "Publisher"]) {
      expect(body, `${route} leaked ${secret}`).not.toContain(secret);
    }
  });

  it("deep and guessed admin subpaths also 404 for an advertiser", async () => {
    const probes = [
      "/admin/sites",
      "/admin/orders",
      "/admin/publishers",
      "/admin/../admin",
      "/api/admin/sites",
      "/api/admin/publishers",
      "/api/admin/stats/",
    ];
    for (const path of probes) {
      const res = await alice.fetch(path);
      expect([404, 308], path).toContain(res.status);
    }
  });

  it("an advertiser cannot reach admin data by flipping their own role in the payload", async () => {
    // There is no route that grants roles; confirm none of the obvious ones do.
    await alice.fetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: emailA, password: TEST_PASSWORD, role: "ADMIN" }),
    });
    await alice.fetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "x", targetUrl: "https://x.example", role: "ADMIN" }),
    });

    const row = await prisma.user.findUnique({ where: { email: emailA }, select: { role: true } });
    expect(row?.role).toBe("ADVERTISER");
    expect((await alice.fetch("/admin")).status).toBe(404);

    // Clean up the throwaway project the probe created.
    const { projects } = await (await alice.fetch("/api/projects")).json();
    for (const p of projects as { id: string; name: string }[]) {
      if (p.name === "x") await alice.fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    }
  });

  it("staff still reach every static admin route", async () => {
    // Only the static ones can be asserted as 200 here: a dynamic route probed
    // with a fabricated id legitimately 404s from its handler, which is
    // indistinguishable from the guard refusing it. Staff access to the dynamic
    // admin routes is proven with real ids in tests/phase3-http.spec.ts.
    const staticRoutes = ADMIN_ROUTES.filter((r) => !isDynamic(r));
    expect(staticRoutes.length).toBeGreaterThan(0);

    for (const route of staticRoutes) {
      const res = await staff.fetch(route);
      expect(res.status, `staff blocked from ${route}`).toBe(200);
    }
    // Generous timeout: this renders every admin page in full through
    // `next dev`, and each one compiles on first hit and runs several queries.
    // The admin home alone takes seconds cold. Nothing here is slow in
    // production — it is the dev server, and the default 30s is not enough now
    // that there are seven of these pages.
  }, 180_000);

  it("dynamic admin routes reach their handler for staff, not the guard", async () => {
    const dynamicRoutes = ADMIN_ROUTES.filter(isDynamic);
    for (const route of dynamicRoutes) {
      const path = fillDynamic(route);
      // Staff reach the handler; an advertiser never does. 405 is allowed for
      // staff because some of these routes implement only a mutating method
      // (the account queue is PATCH-only) — Next answers that before any lookup,
      // so it is identical for every id and reveals nothing.
      // What matters is that neither ever succeeds with a bogus id.
      expect([200, 404, 405]).toContain((await staff.fetch(path)).status);
      expect((await alice.fetch(path)).status).toBe(404);
    }
  });
});

/* ─────────────────────────  NO UNGUARDED SURFACE  ───────────────────────── */

describe("no advertiser-facing route is left unguarded", () => {
  const { apis } = discoverRoutes(APP_DIR);

  // Routes that are legitimately public: the catalog and the sign-in flows.
  const PUBLIC = new Set([
    "/api/sites",
    "/api/sites/facets",
    "/api/auth/signup",
    "/api/auth/password-reset",
  ]);

  const guarded = apis.filter((p) => !PUBLIC.has(p) && !p.startsWith("/api/auth"));

  it("has a guarded route list that is not empty", () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  it.each(guarded)("%s never succeeds for an anonymous caller", async (route) => {
    anon.clearCookies();
    const path = fillDynamic(route);

    // The invariant is that nothing an anonymous caller sends *succeeds*.
    // 401 (no session), 404 (hidden), and 405 (method not implemented on this
    // route) are all acceptable refusals; any 2xx is a hole. Probing every
    // method matters because a route may implement only DELETE or POST, and
    // testing GET alone would miss the one that mutates.
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
      const res = await anon.fetch(path, {
        method,
        ...(method === "GET" ? {} : { body: JSON.stringify({}) }),
      });
      expect(
        res.status,
        `${method} ${path} answered ${res.status} to an anonymous caller`
      ).toBeGreaterThanOrEqual(400);
    }
  });

  /*
   * This used to assert the opposite — that the catalog stayed reachable while
   * signed out. Gating reversed that: the catalog is no longer public, and an
   * anonymous caller must get the same 404 as a route that does not exist.
   */
  it("the catalog is closed to a signed-out caller", async () => {
    anon.clearCookies();
    expect((await anon.fetch("/api/sites?limit=1")).status).toBe(404);
    expect((await anon.fetch("/api/sites/facets")).status).toBe(404);
  });

  it("BASE points at a server that is actually running these routes", async () => {
    // An approved session, since the catalog now needs one. A wrong BASE would
    // fail to sign in rather than answering here at all.
    const res = await staff.fetch("/api/sites?limit=1");
    expect(res.status).toBe(200);
  });
});
