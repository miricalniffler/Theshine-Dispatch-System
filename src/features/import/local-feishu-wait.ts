// A five-minute schedule plus an in-flight run may exceed the old 90 seconds.
export const localFeishuWaitMs = 10 * 60_000;
export function isFreshCompletedLocalRun(run: { status?: string; completedAt?: string | null } | undefined, requestedAt: number) {
  if (!run || (run.status !== 'SUCCEEDED' && run.status !== 'FAILED')) return false;
  const completedAt = Date.parse(run.completedAt || '');
  return Number.isFinite(completedAt) && completedAt >= requestedAt;
}
