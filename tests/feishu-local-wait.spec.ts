import { expect, test } from '@playwright/test';
import { isFreshCompletedLocalRun, localFeishuWaitMs } from '../src/features/import/local-feishu-wait';
test('网页可等待周期助手，旧记录、运行中和请求记录都不算同步完成', () => {
  const requestedAt = Date.parse('2026-11-04T15:20:00Z');
  expect(localFeishuWaitMs).toBeGreaterThanOrEqual(5 * 60_000 + 5 * 60_000);
  for (const status of ['REQUESTED', 'RUNNING']) expect(isFreshCompletedLocalRun({ status, completedAt: '2026-11-04T15:21:00Z' }, requestedAt)).toBeFalsy();
  expect(isFreshCompletedLocalRun({ status: 'SUCCEEDED', completedAt: '2026-11-04T15:19:59Z' }, requestedAt)).toBeFalsy();
  expect(isFreshCompletedLocalRun({ status: 'SUCCEEDED' }, requestedAt)).toBeFalsy();
  expect(isFreshCompletedLocalRun({ status: 'SUCCEEDED', completedAt: '2026-11-04T15:26:00Z' }, requestedAt)).toBeTruthy();
  expect(isFreshCompletedLocalRun({ status: 'FAILED', completedAt: '2026-11-04T15:26:00Z' }, requestedAt)).toBeTruthy();
});
