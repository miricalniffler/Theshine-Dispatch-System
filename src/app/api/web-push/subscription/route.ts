import { z } from "zod";
import { failure, success } from "@/lib/api-response";
import { db } from "@/lib/db";
const schema = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(500) }) });
export async function GET() { return success({ publicKey: process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? null }); }
export async function POST(request: Request) { const value = schema.safeParse(await request.json().catch(() => null)); if (!value.success) return failure("INVALID_SUBSCRIPTION", "通知订阅数据无效。", undefined, 422); await db.webPushSubscription.upsert({ where: { endpoint: value.data.endpoint }, create: { endpoint: value.data.endpoint, p256dh: value.data.keys.p256dh, auth: value.data.keys.auth }, update: { p256dh: value.data.keys.p256dh, auth: value.data.keys.auth } }); return success({ subscribed: true }); }
