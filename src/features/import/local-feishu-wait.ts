// A five-minute schedule plus an in-flight run may exceed the old 90 seconds.
export const localFeishuWaitMs = 10 * 60_000;
export function isFreshCompletedLocalRun(run: { id?: string; status?: string; completedAt?: string | null } | undefined, requestedAt: number, requestedRunId?: string) {
  if (!run || (run.status !== 'SUCCEEDED' && run.status !== 'FAILED')) return false;
  if (requestedRunId && run.id !== requestedRunId) return false;
  const completedAt = Date.parse(run.completedAt || '');
  return Number.isFinite(completedAt) && completedAt >= requestedAt;
}
