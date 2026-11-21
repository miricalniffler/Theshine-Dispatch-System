import { getFeishuSyncStatus } from "@/features/import/feishu-sync";
import { executeManualFeishuSync } from "@/features/import/manual-feishu-sync";
import { listConnectorStatus } from "@/features/import/connectors";
import { failure, success } from "@/lib/api-response";
import { db } from "@/lib/db";

export async function GET() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  const scheduleEnabled = process.env.FEISHU_MAIL_SYNC_ENABLED === "true" || process.env.FEISHU_MAIL_SYNC_ENABLED === "1";
  return success({ connector, scheduleEnabled, cronSecretConfigured: Boolean(process.env.CRON_SECRET), syncMode: connector?.configured ? "server" : "local-helper", latestRun: await getFeishuSyncStatus() });
}

export async function POST() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  if (!connector?.configured) {
    // The established production setup reads the authorised mailbox from a
    // LaunchAgent on the operations Mac. A Vercel request cannot start that
    // process, but it can wait for the helper's next recorded run. Do not
    // report a completed sync here: the browser must still observe a fresh
    // SUCCESS/FAILED run before refreshing its order list.
    // The operations Mac polls the production database.  Persisting a small
    // request record gives a manual click an auditable starting point and
    // lets the browser distinguish the next helper run from an older one.
    // It deliberately contains no mailbox content and does not change orders.
    const requested = await db.importSyncRun.create({
      data: { connector: "feishu-mail", status: "REQUESTED" },
    });
    return success({
      completed: false,
      localScheduled: true,
      requestId: requested.id,
      message: "已请求本机飞书同步助手执行下一轮同步。",
    });
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
