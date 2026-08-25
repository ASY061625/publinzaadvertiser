import { Monitoring } from "@/components/admin/Monitoring";
import { requireAdminPage } from "@/lib/data/session";
import { manualReviewQueue, openAlerts } from "@/lib/monitoring/guarantee";
import { spendToday } from "@/lib/monitoring/metrics";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  // Both staff roles: an editor chases publishers, so they need this queue.
  // Guarded here as well as in the layout — they render concurrently.
  await requireAdminPage();

  const [alerts, manualReview, metricsSpend] = await Promise.all([
    openAlerts(),
    manualReviewQueue(),
    spendToday(),
  ]);

  return (
    <div className="shell shell-narrow">
      <Monitoring
        alerts={alerts.map((a) => ({
          ...a,
          openedAt: a.openedAt.toISOString(),
          refundEligibleAt: a.refundEligibleAt?.toISOString() ?? null,
        }))}
        manualReview={manualReview.map((r) => ({
          ...r,
          checkedAt: r.checkedAt.toISOString(),
        }))}
        metricsSpend={
          metricsSpend
            ? { ...metricsSpend, capHitAt: metricsSpend.capHitAt?.toISOString() ?? null }
            : null
        }
      />
    </div>
  );
}
