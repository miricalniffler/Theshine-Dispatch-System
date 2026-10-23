import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("Gmail 桥接只提交新订单，使用水位线和服务端认证", () => {
  const source = readFileSync(resolve(process.cwd(), "apps-script/gmail-iway-sync/Code.gs"), "utf8");
  expect(source).toContain("everyMinutes(1)");
  expect(source).toContain("IWAY_GMAIL_ENABLED_AT");
  expect(source).toContain("IWAY_GMAIL_INGEST_TOKEN");
  expect(source).toContain("IWAY_GMAIL_TARGET_ENVIRONMENT");
  expect(source).toContain("IWAY_GMAIL_SEEN");
  expect(source).toContain("MAX_THREADS = 20");
  expect(source).toContain("isTrustedSender_");
  expect(source).toContain("Authorization: 'Bearer '");
  expect(source).toContain("cancel(?:led|lation)?");
  expect(source).not.toContain("GmailApp.sendEmail");
});

test("导入接口不接收任意来源，也不会处理取消或修改订单", () => {
  const source = readFileSync(resolve(process.cwd(), "src/features/import/gmail-iway-sync.ts"), "utf8");
  const route = readFileSync(resolve(process.cwd(), "src/app/api/import-sync/gmail-iway/route.ts"), "utf8");
  expect(source).toContain("IWAY_GMAIL_INGEST_TOKEN");
  expect(source).toContain("IWAY_GMAIL_ENABLED_AT");
  expect(route).toContain("GMAIL_SYNC_WRONG_TARGET");
  expect(source).toContain("NEW_ORDER_SKIPPED_EXISTING");
  expect(source).toContain("isTrustedNewOrder");
  expect(source).not.toContain('status: "CANCELLED"');
  expect(source).not.toContain("order.update");
});
