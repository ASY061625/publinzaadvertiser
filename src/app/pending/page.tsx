import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/data/session";
import { needsHolding } from "@/lib/data/access";
import { SignOutButton } from "@/components/ProjectSwitcher";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Account under review — Outpost",
};

/**
 * The holding page. One page for PENDING, REJECTED and SUSPENDED alike.
 *
 * It deliberately says nothing about which of those applies. A rejected
 * applicant who is told why simply signs up again with the gaps filled in, and
 * the wording would tell a competitor exactly what to fake. It also carries no
 * site counts, sample rows or filter skeleton — nothing that hints at what the
 * inventory looks like.
 */
export default async function PendingPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  // An approved account has no business here; send it to the catalog.
  if (!needsHolding(actor)) redirect("/");

  return (
    <div className="app">
      <header className="top">
        <Link href="/pending" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="mark" aria-hidden="true" />
          <span className="wordmark">OUTPOST</span>
        </Link>
        <div className="top-right">
          <SignOutButton />
        </div>
      </header>

      <div className="auth-shell">
        <div className="auth-form" style={{ maxWidth: 520 }}>
          <h1>Your account is under review</h1>

          <p className="auth-hint" style={{ fontSize: 14, marginTop: 12 }}>
            We check every account by hand before opening the catalog. It is the same
            standard we apply to the publications we list, and it is why the catalog is
            worth having access to.
          </p>

          <p className="auth-hint" style={{ fontSize: 14, marginTop: 12 }}>
            We aim to review within one business day. You will get an email at{" "}
            <strong>{actor.email}</strong> as soon as a decision is made — there is
            nothing else for you to do in the meantime.
          </p>

          <p className="auth-hint" style={{ fontSize: 14, marginTop: 12 }}>
            If you have not heard from us within two business days, or you need to add
            anything to your application, reply to your signup email and a person will
            pick it up.
          </p>

          <p className="auth-alt" style={{ marginTop: 22 }}>
            In the meantime you can read{" "}
            <a href="https://outpost.example/vetting">how we vet publications</a> and{" "}
            <a href="https://outpost.example/guarantee">what the guarantee covers</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
