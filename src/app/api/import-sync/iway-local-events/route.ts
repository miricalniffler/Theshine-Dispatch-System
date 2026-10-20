import { timingSafeEqual } from "crypto";
import { failure, success } from "@/lib/api-response";
import type { ImportedMessage } from "@/features/import/connectors";
import { ingestLocalIwayMailMessages } from "@/features/import/feishu-sync";
import { isTrustedIwaySender } from "@/features/import/iway-mail-events";

const maxBatchSize = 30;
const maxTextLength = 100_000;

function tokenMatches(value: string | null) {
  const expected = process.env.IWAY_LOCAL_SYNC_INGEST_TOKEN;
  if (!expected || !value) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(value);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function parseItems(value: unknown): ImportedMessage[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) return null;
  const rows = (value as { items: unknown[] }).items;
  if (rows.length > maxBatchSize) return null;
  const items: ImportedMessage[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const text = typeof item.text === "string" ? item.text : "";
    const sender = typeof item.sender === "string" ? item.sender : "";
    const subject = typeof item.subject === "string" ? item.subject : undefined;
    const receivedAt = typeof item.receivedAt === "string" ? item.receivedAt : undefined;
    if (!id || id.length > 320 || !text.trim() || text.length > maxTextLength || !isTrustedIwaySender(sender)) return null;
    if (receivedAt && Number.isNaN(new Date(receivedAt).getTime())) return null;
    // The server classifies the raw mail; this hint cannot cause cancellation.
    items.push({ id, text, sender, subject, receivedAt, action: "upsert" });
  }
  return items;
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!tokenMatches(token)) return failure("LOCAL_SYNC_UNAUTHORIZED", "本机同步助手认证失败。", undefined, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return failure("INVALID_MAIL_EVENTS", "邮件事件内容不是有效 JSON。", undefined, 400); }
  const items = parseItems(body);
  if (!items) return failure("INVALID_MAIL_EVENTS", "邮件事件格式、来源或批量大小不符合安全要求。", undefined, 400);
  try {
    return success(await ingestLocalIwayMailMessages(items));
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知同步错误";
    return failure("LOCAL_SYNC_FAILED", `本机邮件提交失败：${message}`, undefined, 502);
  }
}
