"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut } from "next-auth/react";
import type { ProjectRecord } from "@/lib/data/projects";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The prototype's top-bar project select, backed by real projects. The chosen
 * project is remembered in a cookie, which the server re-validates against the
 * signed-in user on every read.
 */
export function ProjectSwitcher({
  projects,
  currentId,
}: {
  projects: ProjectRecord[];
  currentId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(value: string) {
    if (value === "__manage__") {
      router.push("/projects");
      return;
    }
    document.cookie = `outpost_project=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  if (projects.length === 0) {
    return (
      <div className="proj">
        <Link className="link-btn" href="/projects">
          Add a project
        </Link>
      </div>
    );
  }

  return (
    <div className="proj">
      <label htmlFor="proj">Project</label>
      <select
        id="proj"
        value={currentId ?? ""}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {hostOf(p.targetUrl)}
          </option>
        ))}
        <option value="__manage__">Manage projects…</option>
      </select>
    </div>
  );
}

export function SignOutButton() {
  return (
    <button className="link-btn" onClick={() => signOut({ callbackUrl: "/login" })}>
      Sign out
    </button>
  );
}
