import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/AuthForms";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
