"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function useRedirectTarget() {
  const params = useSearchParams();
  const next = params.get("next");
  // Only same-site relative paths, so ?next= cannot bounce someone off-site.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/**
 * Signs in by posting the credentials form the way Auth.js expects, letting the
 * browser follow the redirect that sets the session cookie.
 *
 * Deliberately not `signIn()` from next-auth/react: under this version it
 * fetched the CSRF token and then silently gave up without ever posting to the
 * callback, leaving the user on the form with no error. A native submit is also
 * the path the HTTP tests exercise, so the two agree.
 */
async function credentialsLogin(email: string, password: string, callbackUrl: string) {
  const res = await fetch("/api/auth/csrf");
  const { csrfToken } = await res.json();

  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/auth/callback/credentials";

  for (const [name, value] of Object.entries({ csrfToken, email, password, callbackUrl })) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

export function LoginForm() {
  const params = useSearchParams();
  const target = useRedirectTarget();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Auth.js bounces a failed sign-in back here with ?error=. One message for
  // both unknown email and wrong password, so neither is discoverable.
  const failed = params.get("error") ? "Those details don't match an account." : null;
  const justReset = params.get("reset") === "1";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await credentialsLogin(email, password, target);
    } catch {
      setError("Could not reach the sign-in service.");
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>Sign in</h1>
      {justReset && <p className="auth-hint">Password updated. Sign in with your new one.</p>}
      {(error ?? failed) && <p className="auth-error">{error ?? failed}</p>}

      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <p className="auth-alt">
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="auth-alt">
        No account? <Link href="/signup">Create one</Link>
      </p>
    </form>
  );
}

export function SignupForm() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    companyName: "",
    companyWebsite: "",
    jobRole: "",
    promoting: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      setError((await res.json()).error ?? "Could not create that account.");
      setBusy(false);
      return;
    }

    // Signed in immediately, but the account is PENDING, so this lands on the
    // holding page rather than the catalog.
    await credentialsLogin(form.email, form.password, "/pending");
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>Create an account</h1>
      {error && <p className="auth-error">{error}</p>}

      <label htmlFor="name">Name</label>
      <input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} />

      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={form.email}
        onChange={(e) => set("email", e.target.value)}
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        value={form.password}
        onChange={(e) => set("password", e.target.value)}
      />
      <p className="auth-hint">At least 10 characters.</p>

      {/* Review details. Approval is a judgement call, and an email address on
          its own gives a reviewer nothing to judge — which is what makes people
          wait. Asking here is what keeps the queue same-day. */}
      <label htmlFor="companyName">Company</label>
      <input
        id="companyName"
        required
        value={form.companyName}
        onChange={(e) => set("companyName", e.target.value)}
      />

      <label htmlFor="companyWebsite">Company website</label>
      <input
        id="companyWebsite"
        type="url"
        required
        placeholder="https://"
        value={form.companyWebsite}
        onChange={(e) => set("companyWebsite", e.target.value)}
      />

      <label htmlFor="jobRole">Your role</label>
      <input
        id="jobRole"
        value={form.jobRole}
        onChange={(e) => set("jobRole", e.target.value)}
      />

      <label htmlFor="promoting">What are you promoting?</label>
      <input
        id="promoting"
        value={form.promoting}
        onChange={(e) => set("promoting", e.target.value)}
      />

      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Request access"}
      </button>

      {/* Setting the expectation here is what stops the wait feeling alarming. */}
      <p className="auth-hint" style={{ textAlign: "center" }}>
        We review every account by hand, usually within one business day.
      </p>

      <p className="auth-alt">
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    const res = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json();

    setDevToken(body.devResetToken ?? null);
    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="auth-form">
        <h1>Check your email</h1>
        <p className="auth-hint">
          If that address is registered, a reset link is on its way. The link expires in an hour.
        </p>
        {devToken && (
          <>
            <p className="auth-hint">
              No mail is sent yet — email arrives in a later phase. Use this link locally:
            </p>
            <p className="auth-devlink">
              <Link href={`/reset-password?token=${encodeURIComponent(devToken)}`}>
                Set a new password
              </Link>
            </p>
          </>
        )}
        <p className="auth-alt">
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>Reset your password</h1>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send reset link"}
      </button>
      <p className="auth-alt">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/password-reset", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    if (!res.ok) {
      setError((await res.json()).error ?? "Could not reset your password.");
      setBusy(false);
      return;
    }
    router.push("/login?reset=1");
  }

  if (!token) {
    return (
      <div className="auth-form">
        <h1>Reset link missing</h1>
        <p className="auth-hint">That link is incomplete. Request a new one.</p>
        <p className="auth-alt">
          <Link href="/forgot-password">Request a reset link</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>Choose a new password</h1>
      {error && <p className="auth-error">{error}</p>}

      <label htmlFor="password">New password</label>
      <input
        id="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <p className="auth-hint">At least 10 characters.</p>

      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
