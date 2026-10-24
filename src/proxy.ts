import { NextRequest, NextResponse } from "next/server";

// These pages deliberately stay outside the team-login guard. They contain no
// account, order, or configuration data and help diagnose mobile startup.
const publicPaths = ["/login", "/diagnostics/mobile", "/diagnostics/app", "/api/access/login", "/api/access/logout"];

export async function proxy(request: NextRequest) {
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
