import { runFeishuMailSync } from "@/features/import/feishu-sync";
import { failure, success } from "@/lib/api-response";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function enabled() { return process.env.FEISHU_MAIL_SYNC_ENABLED === "true" || process.env.FEISHU_MAIL_SYNC_ENABLED === "1"; }

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!enabled() || !secret) return failure("SYNC_NOT_CONFIGURED", "飞书定时同步尚未启用：请配置 FEISHU_MAIL_SYNC_ENABLED 和 CRON_SECRET。", undefined, 503);
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return failure("UNAUTHORIZED", "定时任务密钥无效。", undefined, 401);
  try { return success(await runFeishuMailSync()); }
  catch (error) { return failure("FEISHU_SYNC_FAILED", error instanceof Error ? error.message : "飞书同步失败。", undefined, 502); }
}
