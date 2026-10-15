import { NextRequest } from "next/server";

// Proxy is a convenience gate for browser navigation. Sensitive API routes
// also check this explicitly so a rewrite, test harness, or future matcher
// change cannot accidentally expose a paid operation or a write endpoint.
export function hasTeamAccess(request: NextRequest) {
  const token = process.env.TEAM_ACCESS_TOKEN;
  return Boolean(token && request.cookies.get("iway-team-access")?.value === token);
}
