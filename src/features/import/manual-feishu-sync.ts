import { FeishuMailSyncInProgressError, runFeishuMailSync, type SyncSummary } from "./feishu-sync";

export type ManualFeishuSyncResult =
  | { kind: "completed"; summary: SyncSummary }
  | { kind: "in-progress"; runId: string; message: string }
  | { kind: "failed"; message: string };

/**
 * The manual endpoint uses the same service as the scheduled sync. Keeping
 * this small boundary injectable makes it explicit that a click executes the
 * sync now, rather than adding work to a local-only queue.
 */
export async function executeManualFeishuSync(
  execute: () => Promise<SyncSummary> = runFeishuMailSync,
): Promise<ManualFeishuSyncResult> {
  try {
    return { kind: "completed", summary: await execute() };
  } catch (error) {
    if (error instanceof FeishuMailSyncInProgressError) {
      return { kind: "in-progress", runId: error.runId, message: error.message };
    }
    return { kind: "failed", message: error instanceof Error ? error.message : "飞书同步失败。" };
  }
}
