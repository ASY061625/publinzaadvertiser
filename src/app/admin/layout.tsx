import { requireAdminPage } from "@/lib/data/session";

// Gate for the whole /admin tree. requireAdminPage calls notFound() for anyone
// who is not ADMIN or EDITOR — signed out, or a signed-in advertiser — so the
// response is a plain 404 and never confirms that these pages exist.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return <div className="app">{children}</div>;
}
