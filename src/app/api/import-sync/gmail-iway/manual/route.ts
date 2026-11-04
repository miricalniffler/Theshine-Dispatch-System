import { NextRequest } from "next/server";
import { failure, success } from "@/lib/api-response";
import { getGmailIwaySyncStatus } from "@/features/import/gmail-iway-sync";
import { triggerManualGmailSync } from "@/features/import/gmail-manual-trigger";

// Defense in depth: proxy.ts also protects this sibling route, but do not rely
// on a matcher change for an endpoint that can cause a real mailbox scan.
function teamAuthorised(request: NextRequest) {
  const expected = process.env.TEAM_ACCESS_TOKEN;
  return Boolean(expected) && request.cookies.get("iway-team-access")?.value === expected;
}

export async function POST(request: NextRequest) {
  if (!teamAuthorised(request)) return failure("UNAUTHORISED", "需要登录后才能手动同步 Gmail。", undefined, 401);
  const result = await triggerManualGmailSync();
  if (result.kind === "unavailable") return failure("GMAIL_MANUAL_SYNC_NOT_CONFIGURED", result.message, undefined, 503);
  if (result.kind === "failed") return failure(result.code || "GMAIL_MANUAL_SYNC_FAILED", result.message, undefined, result.code === "GMAIL_QUOTA_EXHAUSTED" ? 429 : 502);
  if (result.kind === "in-progress") return success({ completed: false, alreadyRunning: true, message: result.message }, 202);
  return success({ completed: true, ...result, latestRun: await getGmailIwaySyncStatus() });
}
