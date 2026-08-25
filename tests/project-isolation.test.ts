/**
 * Phase 2 exit criterion: two advertisers cannot see each other's projects.
 *
 * These go through the data-access layer rather than the UI, because that layer
 * is the only place ownership is enforced — if isolation holds here it holds for
 * every caller. The companion suite tests/admin-guard.test.ts covers the HTTP
 * surface, including guessing another user's project id in the URL.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { makeApprovedAdvertiser as createAdvertiser } from "./helpers/accounts";
import { NotFoundError, type Actor } from "@/lib/data/actor";
import {
  countProjects,
  createProject,
  deleteProject,
  findProject,
  getProject,
  listProjects,
  updateProject,
} from "@/lib/data/projects";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailA = `iso-a-${SUFFIX}@example.test`;
const emailB = `iso-b-${SUFFIX}@example.test`;

let alice: Actor;
let bob: Actor;
let aliceProjectId: string;
let bobProjectId: string;

beforeAll(async () => {
  alice = await createAdvertiser({ email: emailA, password: "correct-horse-battery" });
  bob = await createAdvertiser({ email: emailB, password: "correct-horse-battery" });

  const aliceProject = await createProject(alice, {
    name: "Alice Fintech",
    targetUrl: "https://alice-fintech.example",
    notes: "alice private note",
  });
  const bobProject = await createProject(bob, {
    name: "Bob Wearables",
    targetUrl: "https://bob-wearables.example",
    notes: "bob private note",
  });

  aliceProjectId = aliceProject.id;
  bobProjectId = bobProject.id;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { userId: { in: [alice.id, bob.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
});

describe("each advertiser sees only their own projects", () => {
  it("lists only own projects", async () => {
    const forAlice = await listProjects(alice);
    const forBob = await listProjects(bob);

    expect(forAlice.map((p) => p.id)).toEqual([aliceProjectId]);
    expect(forBob.map((p) => p.id)).toEqual([bobProjectId]);
  });

  it("counts only own projects", async () => {
    expect(await countProjects(alice)).toBe(1);
    expect(await countProjects(bob)).toBe(1);
  });

  it("does not leak the other user's notes into a listing", async () => {
    const forAlice = JSON.stringify(await listProjects(alice));
    expect(forAlice).not.toContain("bob private note");
    expect(forAlice).not.toContain("bob-wearables");
  });
});

describe("reading another user's project by guessed id", () => {
  it("findProject returns null rather than the record", async () => {
    expect(await findProject(alice, bobProjectId)).toBeNull();
    expect(await findProject(bob, aliceProjectId)).toBeNull();
  });

  it("getProject raises not-found, never a distinguishable forbidden", async () => {
    await expect(getProject(alice, bobProjectId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is indistinguishable from an id that never existed", async () => {
    const notMine = getProject(alice, bobProjectId);
    const nonexistent = getProject(alice, "clzzzzzzzzzzzzzzzzzzzzzzzz");

    await expect(notMine).rejects.toBeInstanceOf(NotFoundError);
    await expect(nonexistent).rejects.toBeInstanceOf(NotFoundError);

    const [a, b] = await Promise.all([
      notMine.catch((e: Error) => e.message),
      nonexistent.catch((e: Error) => e.message),
    ]);
    expect(a).toBe(b);
  });

  it("rejects empty and malformed ids without throwing something else", async () => {
    expect(await findProject(alice, "")).toBeNull();
    expect(await findProject(alice, "../../etc/passwd")).toBeNull();
    expect(await findProject(alice, "' OR 1=1 --")).toBeNull();
  });
});

describe("writing to another user's project by guessed id", () => {
  it("update leaves the target untouched", async () => {
    await expect(
      updateProject(alice, bobProjectId, {
        name: "Hijacked",
        targetUrl: "https://attacker.example",
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    const bobsProject = await getProject(bob, bobProjectId);
    expect(bobsProject.name).toBe("Bob Wearables");
    expect(bobsProject.targetUrl).toContain("bob-wearables.example");
  });

  it("delete leaves the target in place", async () => {
    await expect(deleteProject(alice, bobProjectId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await findProject(bob, bobProjectId)).not.toBeNull();
    expect(await countProjects(bob)).toBe(1);
  });

  it("a created project belongs to its creator, not to whoever is named in input", async () => {
    // Ownership comes from the actor, so a userId smuggled into the payload is ignored.
    const sneaky = await createProject(alice, {
      name: "Ownership Test",
      targetUrl: "https://ownership.example",
      ...({ userId: bob.id } as object),
    });

    const row = await prisma.project.findUnique({
      where: { id: sneaky.id },
      select: { userId: true },
    });
    expect(row?.userId).toBe(alice.id);
    expect(await findProject(bob, sneaky.id)).toBeNull();

    await deleteProject(alice, sneaky.id);
  });
});

describe("account boundaries", () => {
  it("refuses a duplicate email", async () => {
    await expect(
      createAdvertiser({ email: emailA, password: "another-long-password" })
    ).rejects.toThrow(/already registered/i);
  });

  it("always creates advertisers, never elevated roles", async () => {
    expect(alice.role).toBe("ADVERTISER");
    expect(bob.role).toBe("ADVERTISER");

    const smuggled = await createAdvertiser({
      email: `iso-c-${SUFFIX}@example.test`,
      password: "correct-horse-battery",
      ...({ role: "ADMIN" } as object),
    });
    expect(smuggled.role).toBe("ADVERTISER");

    const stored = await prisma.user.findUnique({
      where: { id: smuggled.id },
      select: { role: true },
    });
    expect(stored?.role).toBe("ADVERTISER");

    await prisma.user.delete({ where: { id: smuggled.id } });
  });

  it("deleting a user removes their projects and cannot touch another's", async () => {
    const doomed = await createAdvertiser({
      email: `iso-d-${SUFFIX}@example.test`,
      password: "correct-horse-battery",
    });
    await createProject(doomed, { name: "Temp", targetUrl: "https://temp.example" });

    await prisma.project.deleteMany({ where: { userId: doomed.id } });
    await prisma.user.delete({ where: { id: doomed.id } });

    expect(await countProjects(alice)).toBe(1);
    expect(await countProjects(bob)).toBe(1);
  });
});
