import { getFeishuSyncStatus } from "@/features/import/feishu-sync";
import { listConnectorStatus } from "@/features/import/connectors";
import { success } from "@/lib/api-response";

export async function GET() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  const scheduleEnabled = process.env.FEISHU_MAIL_SYNC_ENABLED === "true" || process.env.FEISHU_MAIL_SYNC_ENABLED === "1";
  return success({ connector, scheduleEnabled, cronSecretConfigured: Boolean(process.env.CRON_SECRET), latestRun: await getFeishuSyncStatus() });
}
