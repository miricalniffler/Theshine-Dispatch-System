/**
 * Keep the external-sync conflict rule independent from the database layer so
 * it can be checked with representative messages without contacting Feishu.
 */
export type FeishuSyncAction = "upsert" | "cancel";
export type FeishuOrderState = "CANCELLED" | "COMPLETED" | string;
export type FeishuUpdateDecision = "apply" | "restore-external-cancel" | "skip-completed" | "skip-local-cancel";

export function decideFeishuUpdate(state: FeishuOrderState, lastCancellationWasFeishu: boolean): FeishuUpdateDecision {
  if (state === "COMPLETED") return "skip-completed";
  if (state !== "CANCELLED") return "apply";
  return lastCancellationWasFeishu ? "restore-external-cancel" : "skip-local-cancel";
}

export function mayFeishuCancel(state: FeishuOrderState) {
  // A completed/returned operational record is never silently cancelled by a
  // delayed external email.  Other active states may be cancelled.
  return state !== "CANCELLED" && state !== "COMPLETED";
}
