import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/AuthForms";
import { currentActor } from "@/lib/data/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in? Nothing to do here.
  if (await currentActor()) redirect("/");

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
