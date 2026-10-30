import { NextRequest, NextResponse } from "next/server";

// These pages deliberately stay outside the team-login guard. They contain no
// account, order, or configuration data and help diagnose mobile startup.
const publicPaths = ["/login", "/diagnostics/mobile", "/diagnostics/app", "/service-worker.js", "/api/access/login", "/api/access/logout"];

export async function proxy(request: NextRequest) {
  // This server-to-server POST authenticates its own dedicated bearer token.
  // Redirecting it to the team login preserves POST and produces a 405 there.
  // Keep GET/status and every other method behind the team-login guard.
  if (request.method === "POST" && request.nextUrl.pathname === "/api/import-sync/gmail-iway") {
    return NextResponse.next();
  }
  if (publicPaths.some((path) => request.nextUrl.pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (request.cookies.get("iway-team-access")?.value !== process.env.TEAM_ACCESS_TOKEN) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
