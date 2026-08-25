import { cookies } from "next/headers";
import { findProject, listProjects, type ProjectRecord } from "./projects";
import type { Actor } from "./actor";

export const PROJECT_COOKIE = "outpost_project";

/**
 * Resolves which project the top bar is currently pointed at.
 *
 * The cookie is untrusted input: it is looked up through findProject, which
 * scopes to the actor. A cookie carrying someone else's project id resolves to
 * null and falls back to the actor's first project, so editing the cookie by
 * hand gains nothing.
 */
export async function resolveCurrentProject(
  actor: Actor
): Promise<{ current: ProjectRecord | null; projects: ProjectRecord[] }> {
  const projects = await listProjects(actor);
  if (projects.length === 0) return { current: null, projects };

  const requested = (await cookies()).get(PROJECT_COOKIE)?.value;
  if (requested) {
    const owned = await findProject(actor, requested);
    if (owned) return { current: owned, projects };
  }

  return { current: projects[0], projects };
}
