import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/AuthForms";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
