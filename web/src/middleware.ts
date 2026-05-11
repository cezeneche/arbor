import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware runs on the Edge — no access to localStorage.
// We use a cookie "cbam_token" set by the client after login.
export function middleware(request: NextRequest) {
  const token = request.cookies.get("cbam_token")?.value;
  const { pathname } = request.nextUrl;

  // Public routes — always accessible (no auth required)
  // "/" renders a dual state: scope checker (unauthed) vs dashboard (authed) — never redirect
  if (pathname === "/") return NextResponse.next();
  if (pathname.startsWith("/login"))         return NextResponse.next();
  if (pathname.startsWith("/signup"))        return NextResponse.next();
  if (pathname.startsWith("/design-system")) return NextResponse.next();
  if (pathname.startsWith("/supplier/"))     return NextResponse.next();

  // Protected routes — redirect to login if no token
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Exclude Next.js internals, static assets, and API proxy routes
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api-proxy).*)"],
};
