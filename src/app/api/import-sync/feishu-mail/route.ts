import { getFeishuSyncStatus } from "@/features/import/feishu-sync";
import { listConnectorStatus } from "@/features/import/connectors";
import { success } from "@/lib/api-response";
import { db } from "@/lib/db";

export async function GET() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  const scheduleEnabled = process.env.FEISHU_MAIL_SYNC_ENABLED === "true" || process.env.FEISHU_MAIL_SYNC_ENABLED === "1";
  return success({ connector, scheduleEnabled, cronSecretConfigured: Boolean(process.env.CRON_SECRET), latestRun: await getFeishuSyncStatus() });
}

export async function POST() {
  const pending = await db.importSyncRun.findFirst({
    where: { connector: "feishu-mail", status: { in: ["REQUESTED", "RUNNING"] } },
    orderBy: { startedAt: "desc" },
  });
  if (pending) return success({ queued: true, alreadyQueued: true, runId: pending.id });
  const request = await db.importSyncRun.create({ data: { connector: "feishu-mail", status: "REQUESTED" } });
  return success({ queued: true, alreadyQueued: false, runId: request.id });
}
