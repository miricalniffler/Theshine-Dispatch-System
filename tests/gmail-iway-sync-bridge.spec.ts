import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyGmailIwayMessage } from "../src/features/import/gmail-iway-sync";

const validMail = {
  id: "gmail-message-1",
  sender: "iWay Control <control@iwayex.com>",
  subject: "Transfer service order",
  receivedAt: "2026-10-22T22:00:00.000Z",
  text: `Ride number: 1 114 217
Date: 23.10
Time: 05:30
Vehicle class: C (COMFORT)
Clients: Trofimova Daria, phone +7 902 997–70–44
Number of passengers: 2
Children: 0
Luggage: 2
Itinerary:
From: Suvarnabhumi Airport
To: Sukhumvit 24, Bangkok
Flight number/train number: none
Departure time: 23.10.2026 02:00`,
};

test("Gmail 桥接只提交新订单，使用水位线和服务端认证", () => {
  const source = readFileSync(resolve(process.cwd(), "apps-script/gmail-iway-sync/Code.gs"), "utf8");
  expect(source).toContain("everyMinutes(1)");
  expect(source).toContain("IWAY_GMAIL_ENABLED_AT");
  expect(source).toContain("IWAY_GMAIL_INGEST_TOKEN");
  expect(source).toContain("IWAY_GMAIL_TARGET_ENVIRONMENT");
  expect(source).toContain("IWAY_GMAIL_VERCEL_PROTECTION_BYPASS_SECRET");
  expect(source).toContain("x-vercel-protection-bypass");
  expect(source).toContain("IWAY_GMAIL_SEEN");
  expect(source).toContain("THREAD_PAGE_SIZE = 50");
  expect(source).toContain("IWAY_GMAIL_SCAN_OFFSET");
  expect(source).toContain("advanceScanOffset_");
  expect(source).toContain("SCAN_OVERLAP_THREADS");
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
  expect(source).toContain("isTrustedGmailNewOrder");
  expect(source).not.toContain('status: "CANCELLED"');
  expect(source).not.toContain("order.update");
});

test("云端导入只接受可信、启用后且可确定城市与时区的新订单", () => {
  const enabledAt = "2026-10-22T21:00:00.000Z";
  expect(classifyGmailIwayMessage(validMail, enabledAt)).toMatchObject({ accepted: true, parsed: { platformOrderNumber: "1114217", serviceTimeZone: "Asia/Bangkok" } });
  expect(classifyGmailIwayMessage({ ...validMail, sender: "forwarder@example.com" }, enabledAt)).toMatchObject({ accepted: false, reason: "UNTRUSTED_OR_NOT_NEW_ORDER" });
  expect(classifyGmailIwayMessage({ ...validMail, subject: "Order cancelled" }, enabledAt)).toMatchObject({ accepted: false, reason: "UNTRUSTED_OR_NOT_NEW_ORDER" });
  expect(classifyGmailIwayMessage({ ...validMail, receivedAt: "2026-10-22T20:59:59.000Z" }, enabledAt)).toMatchObject({ accepted: false, reason: "BEFORE_ENABLE_WATERLINE" });
  expect(classifyGmailIwayMessage({ ...validMail, text: validMail.text.replace("Suvarnabhumi Airport", "Unknown origin").replace("Sukhumvit 24, Bangkok", "Unknown destination") }, enabledAt)).toMatchObject({ accepted: false, reason: "NEW_ORDER_REJECTED_CITY_UNCONFIRMED" });
});
