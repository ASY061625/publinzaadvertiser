import Link from "next/link";

// Chrome for the signed-out pages: brand only, no project switcher or balance,
// since neither exists until someone is signed in.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <header className="top">
        <Link href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="mark" aria-hidden="true" />
          <span className="wordmark">OUTPOST</span>
        </Link>
      </header>
      <div className="auth-shell">{children}</div>
    </div>
  );
}
