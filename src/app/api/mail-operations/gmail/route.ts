import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { failure, success } from "@/lib/api-response";
import { ingestMailOperations } from "@/features/mail-operations/service";
const schema = z.object({ messages: z.array(z.object({ id: z.string().min(1).max(300), threadId: z.string().max(300).optional(), sender: z.string().min(3).max(320), subject: z.string().min(1).max(500), receivedAt: z.string().datetime({ offset: true }), text: z.string().min(1).max(60000) })).min(1).max(20) });
function authorised(request: Request) { const expected = process.env.IWAY_GMAIL_INGEST_TOKEN?.trim(); const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim(); if (!expected || !provided) return false; const a = Buffer.from(expected); const b = Buffer.from(provided); return a.length === b.length && timingSafeEqual(a, b); }
export async function POST(request: Request) { if (!authorised(request)) return failure("UNAUTHORISED", "Gmail 同步身份验证失败。", undefined, 401); const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return failure("INVALID_GMAIL_BATCH", "邮件批次格式无效。", undefined, 422); return success(await ingestMailOperations(parsed.data.messages)); }
