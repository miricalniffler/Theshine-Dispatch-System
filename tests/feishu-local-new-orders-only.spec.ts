import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("本机恢复助手只导入新订单，不能取消或覆盖已有订单", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/import-future-iway-from-lark.mjs"), "utf8");
  expect(source).toContain("isLocalNewOrderSubject(mail.subject)");
  expect(source).not.toContain("isCancellationSubject");
  expect(source).not.toContain("db.order.update");
  expect(source).not.toContain('status: "CANCELLED"');
  // Ensuring the configured city fleet exists is not an order mutation.
  expect(source).toContain("fleet.upsert");
  expect(source).toContain("if (existing) { summary.unchanged.push(item.orderNo); continue; }");
  expect(source).toContain("isOrderAlreadyCreated");
  expect(source).toContain("if (!isOrderAlreadyCreated(error)) throw error;");
  expect(source).toContain("databaseRetryAttempts = 3");
  expect(source).toContain("isTransientDatabaseError");
  expect(source).toContain('status: "REQUESTED"');
  expect(source).toContain("Claim the oldest web-requested run");
  expect(source).toContain("sender: officialSender, max: 80");
  expect(source).toContain("sender: newRideSender, max: 80");
  expect(source).toContain('status: "SUCCEEDED"');
});
