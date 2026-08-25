import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/AuthForms";
import { currentActor } from "@/lib/data/session";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await currentActor()) redirect("/");

  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
