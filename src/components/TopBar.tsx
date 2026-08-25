import Link from "next/link";
import { ProjectSwitcher, SignOutButton } from "./ProjectSwitcher";
import { formatCents } from "@/lib/format";
import { currentActor } from "@/lib/data/session";
import { resolveCurrentProject } from "@/lib/data/current-project";
import { isAdmin } from "@/lib/data/actor";
import { prisma } from "@/lib/db";

/**
 * Server component. Loads the actor, their projects and their wallet, so the
 * client switcher never receives anything that isn't already theirs.
 */
export async function TopBar() {
  const actor = await currentActor();

  if (!actor) {
    return (
      <header className="top">
        <Link href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="mark" aria-hidden="true" />
          <span className="wordmark">OUTPOST</span>
        </Link>
        <div className="top-right">
          <Link className="link-btn" href="/login">
            Sign in
          </Link>
          <Link className="btn btn-sm" href="/signup">
            Create account
          </Link>
        </div>
      </header>
    );
  }

  const [{ current, projects }, wallet] = await Promise.all([
    resolveCurrentProject(actor),
    prisma.wallet.findUnique({
      where: { userId: actor.id },
      select: { balanceCents: true },
    }),
  ]);

  return (
    <header className="top">
      <Link href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
        <span className="mark" aria-hidden="true" />
        <span className="wordmark">OUTPOST</span>
      </Link>

      <div className="top-right">
        <Link className="link-btn" href="/orders">
          Orders
        </Link>

        <ProjectSwitcher projects={projects} currentId={current?.id ?? null} />

        <div className="bal">
          <span className="bal-label">Balance</span>
          <span className="bal-num">{formatCents(wallet?.balanceCents ?? 0)}</span>
        </div>

        {/* Only rendered for staff. The /admin routes 404 for everyone else, so
            showing this link to an advertiser would advertise a dead end. */}
        {isAdmin(actor) && (
          <Link className="link-btn" href="/admin">
            Internal
          </Link>
        )}

        <SignOutButton />
      </div>
    </header>
  );
}
