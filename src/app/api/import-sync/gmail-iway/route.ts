import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { failure, success } from "@/lib/api-response";
import { getGmailIwaySyncStatus, gmailIwaySyncReady, ingestGmailIwayMessages } from "@/features/import/gmail-iway-sync";

const messageSchema = z.object({
  id: z.string().trim().min(1).max(300),
  sender: z.string().trim().min(3).max(320),
  subject: z.string().trim().min(1).max(500),
  receivedAt: z.string().datetime({ offset: true }),
  text: z.string().trim().min(1).max(60_000),
});
const requestSchema = z.object({
  // The Apps Script must name its intended target.  A Preview token cannot be
  // used to silently turn a Production endpoint into a test endpoint.
  targetEnvironment: z.enum(["preview", "production"]),
  messages: z.array(messageSchema).min(1).max(20),
});

function authorised(request: Request) {
  const expected = process.env.IWAY_GMAIL_INGEST_TOKEN?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET() {
  return success({ configured: gmailIwaySyncReady(), latestRun: await getGmailIwaySyncStatus() });
}

export async function POST(request: Request) {
  if (!authorised(request)) return failure("UNAUTHORISED", "Gmail 同步身份验证失败。", undefined, 401);
  if (!gmailIwaySyncReady()) return failure("GMAIL_SYNC_NOT_ENABLED", "Gmail 同步尚未完成安全启用。", undefined, 503);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failure("INVALID_GMAIL_BATCH", "Gmail 同步请求格式无效。", undefined, 422);
  if (parsed.data.targetEnvironment !== process.env.IWAY_GMAIL_TARGET_ENVIRONMENT?.trim()) {
    return failure("GMAIL_SYNC_WRONG_TARGET", "Gmail 同步目标环境不匹配，已拒绝导入。", undefined, 409);
  }
  try { return success(await ingestGmailIwayMessages(parsed.data.messages)); }
  catch { return failure("GMAIL_SYNC_FAILED", "Gmail 新订单导入失败；请稍后重试。", undefined, 502); }
}
