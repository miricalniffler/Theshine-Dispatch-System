import { getFeishuSyncStatus } from "@/features/import/feishu-sync";
import { executeManualFeishuSync } from "@/features/import/manual-feishu-sync";
import { listConnectorStatus } from "@/features/import/connectors";
import { failure, success } from "@/lib/api-response";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  const scheduleEnabled = process.env.FEISHU_MAIL_SYNC_ENABLED === "true" || process.env.FEISHU_MAIL_SYNC_ENABLED === "1";
  const requestedRunId = new URL(request.url).searchParams.get("runId") || undefined;
  return success({ connector, scheduleEnabled, cronSecretConfigured: Boolean(process.env.CRON_SECRET), syncMode: connector?.configured ? "server" : "local-helper", latestRun: await getFeishuSyncStatus(requestedRunId) });
}

export async function POST() {
  const connector = listConnectorStatus().find((item) => item.id === "feishu-mail");
  if (!connector?.configured) {
    // The Mac LaunchAgent polls the shared database. Recording an explicit
    // request makes a button click actionable by the next helper invocation,
    // rather than merely waiting for an unrelated periodic run to finish.
    // This remains queued work; the browser reports completion only after the
    // local helper claims and completes this exact run.
    const requested = await db.importSyncRun.create({
      data: { connector: "feishu-mail", status: "REQUESTED" },
    });
    return success({
      completed: false,
      localScheduled: true,
      runId: requested.id,
      requestedAt: requested.startedAt,
      message: "已将立即同步请求交给本机飞书助手；等待助手确认并完成数据库写入。",
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
