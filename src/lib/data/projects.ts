import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, type Actor } from "./actor";

export type ProjectInput = {
  name: string;
  targetUrl: string;
  notes?: string | null;
};

export type ProjectRecord = {
  id: string;
  name: string;
  targetUrl: string;
  notes: string | null;
  createdAt: Date;
};

const SELECT = {
  id: true,
  name: true,
  targetUrl: true,
  notes: true,
  createdAt: true,
} as const;

/**
 * Ownership lives in the WHERE clause of every statement below, never in an
 * `if` after the fact. A read that is not the actor's returns nothing, and a
 * write that is not the actor's matches zero rows — so a guessed id behaves
 * exactly like an id that was never issued.
 */
function ownedBy(actor: Actor) {
  return { userId: actor.id };
}

function validate(input: ProjectInput): ProjectInput {
  const name = input.name?.trim() ?? "";
  const targetUrl = input.targetUrl?.trim() ?? "";

  if (name.length < 1) throw new ValidationError("Project name is required.");
  if (name.length > 120) throw new ValidationError("Project name is too long.");
  if (targetUrl.length < 1) throw new ValidationError("Target domain is required.");
  if (targetUrl.length > 300) throw new ValidationError("Target domain is too long.");

  let parsed: URL;
  try {
    parsed = new URL(targetUrl.includes("://") ? targetUrl : `https://${targetUrl}`);
  } catch {
    throw new ValidationError("Target domain must be a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("Target domain must be an http or https URL.");
  }

  const notes = input.notes?.trim();
  if (notes && notes.length > 2000) throw new ValidationError("Notes are too long.");

  return { name, targetUrl: parsed.toString(), notes: notes || null };
}

export async function listProjects(actor: Actor): Promise<ProjectRecord[]> {
  return prisma.project.findMany({
    where: ownedBy(actor),
    select: SELECT,
    orderBy: { createdAt: "asc" },
  });
}

export async function countProjects(actor: Actor): Promise<number> {
  return prisma.project.count({ where: ownedBy(actor) });
}

/** Returns null for both "no such project" and "not yours" — callers 404 either way. */
export async function findProject(actor: Actor, projectId: string): Promise<ProjectRecord | null> {
  if (!projectId) return null;
  return prisma.project.findFirst({
    where: { id: projectId, ...ownedBy(actor) },
    select: SELECT,
  });
}

export async function getProject(actor: Actor, projectId: string): Promise<ProjectRecord> {
  const project = await findProject(actor, projectId);
  if (!project) throw new NotFoundError();
  return project;
}

export async function createProject(actor: Actor, input: ProjectInput): Promise<ProjectRecord> {
  const clean = validate(input);
  return prisma.project.create({
    data: { ...clean, userId: actor.id },
    select: SELECT,
  });
}

export async function updateProject(
  actor: Actor,
  projectId: string,
  input: ProjectInput
): Promise<ProjectRecord> {
  const clean = validate(input);

  // updateMany, not update: the ownership predicate is part of the statement,
  // so someone else's id simply matches nothing instead of updating a row.
  const result = await prisma.project.updateMany({
    where: { id: projectId, ...ownedBy(actor) },
    data: clean,
  });
  if (result.count === 0) throw new NotFoundError();

  return getProject(actor, projectId);
}

export async function deleteProject(actor: Actor, projectId: string): Promise<void> {
  const result = await prisma.project.deleteMany({
    where: { id: projectId, ...ownedBy(actor) },
  });
  if (result.count === 0) throw new NotFoundError();
}
