import { getFeishuSyncStatus } from "@/features/import/feishu-sync";
import { executeManualFeishuSync } from "@/features/import/manual-feishu-sync";
import { listConnectorStatus } from "@/features/import/connectors";
import { failure, success } from "@/lib/api-response";
import { db } from "@/lib/db";

const staleRunMs = 5 * 60_000;

export async function GET() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  const scheduleEnabled = process.env.FEISHU_MAIL_SYNC_ENABLED === "true" || process.env.FEISHU_MAIL_SYNC_ENABLED === "1";
  return success({ connector, scheduleEnabled, cronSecretConfigured: Boolean(process.env.CRON_SECRET), syncMode: connector?.configured ? "server" : "local-helper", latestRun: await getFeishuSyncStatus() });
}

export async function POST() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  if (!connector?.configured) {
    // This Vercel project has no Feishu bridge yet. Use the signed-in Mac
    // helper instead of silently failing a manual refresh.
    const staleBefore = new Date(Date.now() - staleRunMs);
    await db.importSyncRun.updateMany({
      where: { connector: "feishu-mail", status: "RUNNING", startedAt: { lt: staleBefore } },
      data: { status: "FAILED", completedAt: new Date(), errorMessage: "本机飞书同步助手超过 5 分钟未完成，已自动释放；请重新同步。" },
    });
    const pending = await db.importSyncRun.findFirst({
      where: { connector: "feishu-mail", status: { in: ["REQUESTED", "RUNNING"] } },
      orderBy: { startedAt: "desc" },
    });
    if (pending) return success({ completed: false, queuedLocalHelper: true, alreadyQueued: true, runId: pending.id, message: "已交由这台电脑上的飞书同步助手处理。" });
    const request = await db.importSyncRun.create({ data: { connector: "feishu-mail", status: "REQUESTED" } });
    return success({ completed: false, queuedLocalHelper: true, alreadyQueued: false, runId: request.id, message: "已交由这台电脑上的飞书同步助手处理。" });
  }

  // Once Vercel has a real Feishu bridge, clear legacy local-helper requests
  // and run the existing sync service directly.
  await db.importSyncRun.updateMany({
    where: { connector: "feishu-mail", status: "REQUESTED" },
    data: { status: "FAILED", completedAt: new Date(), errorMessage: "旧版本地同步请求未执行；现已改由服务器直接同步。" },
  });
  const result = await executeManualFeishuSync();
  if (result.kind === "completed") return success({ completed: true, ...result.summary });
  if (result.kind === "in-progress") return success({ completed: false, alreadyRunning: true, runId: result.runId, message: result.message });
  return failure("FEISHU_SYNC_FAILED", result.message, undefined, 502);
}
