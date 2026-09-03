import { expect, test } from "@playwright/test";
import { FeishuMailSyncInProgressError } from "../src/features/import/feishu-sync";
import { executeManualFeishuSync } from "../src/features/import/manual-feishu-sync";

test("手动同步会直接执行现有同步服务，并回传完整统计", async () => {
  let calls = 0;
  const result = await executeManualFeishuSync(async () => {
    calls += 1;
    return { runId: "run-1", created: 2, updated: 3, cancelled: 1, skipped: 4 };
  });

  expect(calls).toBe(1);
  expect(result).toEqual({ kind: "completed", summary: { runId: "run-1", created: 2, updated: 3, cancelled: 1, skipped: 4 } });
});

test("已有同步运行时不再次执行同步服务", async () => {
  let calls = 0;
  const result = await executeManualFeishuSync(async () => {
    calls += 1;
    throw new FeishuMailSyncInProgressError("run-active");
  });

  expect(calls).toBe(1);
  expect(result).toMatchObject({ kind: "in-progress", runId: "run-active" });
});
