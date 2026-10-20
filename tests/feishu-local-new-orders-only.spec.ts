import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("本机恢复助手只导入新订单，不能取消或覆盖已有订单", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/import-future-iway-from-lark.mjs"), "utf8");
  expect(source).toContain("Transfer service order|New ride");
  expect(source).not.toContain("isCancellationSubject");
  expect(source).not.toContain("db.order.update");
  expect(source).not.toContain('status: "CANCELLED"');
  expect(source).not.toContain("fleet.upsert");
  expect(source).toContain("if (existing) { summary.unchanged.push(item.orderNo); continue; }");
});
