import { getFeishuSyncStatus } from "@/features/import/feishu-sync";
import { listConnectorStatus } from "@/features/import/connectors";
import { success } from "@/lib/api-response";
import { db } from "@/lib/db";

const staleRunMs = 5 * 60_000;

export async function GET() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  const scheduleEnabled = process.env.FEISHU_MAIL_SYNC_ENABLED === "true" || process.env.FEISHU_MAIL_SYNC_ENABLED === "1";
  return success({ connector, scheduleEnabled, cronSecretConfigured: Boolean(process.env.CRON_SECRET), latestRun: await getFeishuSyncStatus() });
}

export async function POST() {
  const staleBefore = new Date(Date.now() - staleRunMs);
  // Never let an interrupted local mailbox worker block every later refresh.
  // The next request becomes a fresh job that the local helper can collect.
  const expired = await db.importSyncRun.updateMany({
    where: { connector: "feishu-mail", status: "RUNNING", startedAt: { lt: staleBefore } },
    data: { status: "FAILED", completedAt: new Date(), errorMessage: "同步助手超过 5 分钟未完成，已自动释放；请重新同步。" },
  });
  const pending = await db.importSyncRun.findFirst({
    where: { connector: "feishu-mail", status: { in: ["REQUESTED", "RUNNING"] } },
    orderBy: { startedAt: "desc" },
  });
  if (pending) return success({ queued: true, alreadyQueued: true, runId: pending.id, recoveredStaleRuns: expired.count });
  const request = await db.importSyncRun.create({ data: { connector: "feishu-mail", status: "REQUESTED" } });
  return success({ queued: true, alreadyQueued: false, runId: request.id, recoveredStaleRuns: expired.count });
}
