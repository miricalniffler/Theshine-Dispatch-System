import { getFeishuSyncStatus } from "@/features/import/feishu-sync";
import { executeManualFeishuSync } from "@/features/import/manual-feishu-sync";
import { listConnectorStatus } from "@/features/import/connectors";
import { failure, success } from "@/lib/api-response";
import { db } from "@/lib/db";
import { isIsolatedPreview } from "@/lib/isolated-preview";

export async function GET() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  const scheduleEnabled = !isIsolatedPreview && (process.env.FEISHU_MAIL_SYNC_ENABLED === "true" || process.env.FEISHU_MAIL_SYNC_ENABLED === "1");
  return success({ connector, scheduleEnabled, cronSecretConfigured: Boolean(process.env.CRON_SECRET), syncMode: connector?.configured ? "server" : "local-scheduled", latestRun: await getFeishuSyncStatus() });
}

export async function POST() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  if (!connector?.configured) {
    // The production server has no authorised Feishu bridge. The Mac
    // LaunchAgent reads Feishu on its own schedule, irrespective of this UI
    // action; a click only asks the page to wait for the next recorded run.
    return success({ completed: false, localScheduled: true, message: "服务器飞书连接未启用；本机同步助手会按周期自动读取飞书。" });
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
