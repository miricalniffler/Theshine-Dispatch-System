import { NextRequest } from "next/server";
import { failure, success } from "@/lib/api-response";
import { getGmailManualTriggerStatus, triggerManualGmailSync } from "@/features/import/gmail-manual-trigger";

function teamAuthorised(request: NextRequest) {
  const expected = process.env.TEAM_ACCESS_TOKEN;
  return Boolean(expected) && request.cookies.get("iway-team-access")?.value === expected;
}

export async function GET(request: NextRequest) {
  if (!teamAuthorised(request)) return failure("UNAUTHORISED", "需要登录后才能读取 Gmail 邮件同步状态。", undefined, 401);
  const status = await getGmailManualTriggerStatus();
  return success({ available: status.available, latestSuccessfulSyncAt: status.latestOperationsSuccessAt });
}

export async function POST(request: NextRequest) {
  if (!teamAuthorised(request)) return failure("UNAUTHORISED", "需要登录后才能手动同步 Gmail 邮件。", undefined, 401);
  const result = await triggerManualGmailSync(fetch, "operations");
  if (result.kind === "unavailable") return failure("GMAIL_MANUAL_SYNC_NOT_CONFIGURED", result.message, undefined, 503);
  if (result.kind === "failed") return failure(result.code || "GMAIL_MANUAL_SYNC_FAILED", result.message, undefined, result.code === "GMAIL_QUOTA_EXHAUSTED" ? 429 : 502);
  if (result.kind === "in-progress") return success({ completed: false, alreadyRunning: true, message: result.message }, 202);
  return success({ completed: true, created: result.created, skipped: result.skipped, latestSuccessfulSyncAt: result.latestSuccessAt });
}
