import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

/**
 * First line of the admin guard: refuse /admin and /api/admin before any
 * component renders.
 *
 * The layout and page guards are the authoritative ones (they re-read the role
 * from the database). This exists because a server component that only checks
 * in its layout still streams the page's markup — the response carries a 404
 * status with the content attached. Blocking here means nothing renders at all.
 *
 * Edge runtime, so this reads the role from the signed JWT rather than Prisma.
 * A stale token can at most get someone past this check and into the layout
 * guard, which then verifies against the database.
 */

const ADMIN_ROLES = new Set(["ADMIN", "EDITOR"]);

export async function middleware(request: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  const isSecure = request.nextUrl.protocol === "https:";
  const cookieName = isSecure ? "__Secure-authjs.session-token" : "authjs.session-token";

  let role: unknown;
  try {
    const token = await getToken({
      req: request,
      secret,
      salt: cookieName,
      cookieName,
      secureCookie: isSecure,
    });
    role = token?.role;
  } catch {
    role = undefined; // Unreadable or tampered token is simply not staff.
  }

  if (typeof role === "string" && ADMIN_ROLES.has(role)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Rewrite to a path that does not exist so Next renders its own 404 page.
  // The visitor cannot tell this route from one that was never defined.
  return NextResponse.rewrite(new URL("/_outpost_missing", request.url), { status: 404 });
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
