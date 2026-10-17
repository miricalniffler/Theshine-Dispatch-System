import { expect, test } from "@playwright/test";
import { decideFeishuUpdate, mayFeishuCancel } from "../src/features/import/feishu-sync-policy";

test("飞书更新不会覆盖本地取消或已完成订单", () => {
  expect(decideFeishuUpdate("CANCELLED", false)).toBe("skip-local-cancel");
  expect(decideFeishuUpdate("COMPLETED", true)).toBe("skip-completed");
  expect(mayFeishuCancel("COMPLETED")).toBe(false);
});

test("只有飞书自身先前取消的订单可由新飞书订单恢复", () => {
  expect(decideFeishuUpdate("CANCELLED", true)).toBe("restore-external-cancel");
  expect(decideFeishuUpdate("READY_TO_DISPATCH", false)).toBe("apply");
  expect(mayFeishuCancel("DRIVER_CONFIRMED")).toBe(true);
});
