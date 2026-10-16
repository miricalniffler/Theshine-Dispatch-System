import { NextRequest, NextResponse } from "next/server";
import { isolatedPreviewValue } from "@/lib/isolated-preview";

const publicPaths = ["/login", "/api/access/login", "/api/access/logout"];

export async function proxy(request: NextRequest) {
  if (publicPaths.some((path) => request.nextUrl.pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const accessToken = isolatedPreviewValue("TEAM_ACCESS_TOKEN");
  // Missing configuration must protect the application, rather than making
  // an absent cookie compare equal to an absent environment variable.
  if (!accessToken || request.cookies.get("iway-team-access")?.value !== accessToken) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
