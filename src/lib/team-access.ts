import { NextRequest } from "next/server";
import { isolatedPreviewValue } from "@/lib/isolated-preview";

// Proxy is a convenience gate for browser navigation. Sensitive API routes
// also check this explicitly so a rewrite, test harness, or future matcher
// change cannot accidentally expose a paid operation or a write endpoint.
export function hasTeamAccess(request: NextRequest) {
  const token = isolatedPreviewValue("TEAM_ACCESS_TOKEN");
  return Boolean(token && request.cookies.get("iway-team-access")?.value === token);
}
