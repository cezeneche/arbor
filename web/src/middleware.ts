import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware runs on the Edge — no access to localStorage.
// We use a cookie "cbam_token" set by the client after login.
export function middleware(request: NextRequest) {
  const token = request.cookies.get("cbam_token")?.value;
  const { pathname } = request.nextUrl;

  // Public routes — always accessible
  if (pathname.startsWith("/login")) return NextResponse.next();

  // Protected routes — redirect to login if no token
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
