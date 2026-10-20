import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyIwayMail } from "../src/features/import/iway-mail-events";

const trusted = (subject: string, text = "Ride number: 949810") => ({ id: subject, sender: "control@iwayex.com", subject, text, receivedAt: "2026-10-20T10:00:00Z", action: "upsert" as const });
test("明确取消需要可信来源、明确主题和订单号", () => expect(classifyIwayMail(trusted("Transfer 949810 has been cancelled")).type).toBe("CANCELLATION_CONFIRMED"));
test("取消请求和费用讨论只进入待核对", () => { expect(classifyIwayMail(trusted("Cancellation request for 949810")).type).toBe("REVIEW"); expect(classifyIwayMail(trusted("Cancellation fee for 949810")).type).toBe("REVIEW"); });
test("修改邮件只生成待确认事件", () => expect(classifyIwayMail(trusted("AMENDMENT to the transfer 949810")).type).toBe("MODIFICATION"));
test("非白名单发件人不能触发自动取消", () => expect(classifyIwayMail({ ...trusted("Transfer 949810 has been cancelled"), sender: "spoof@example.com" }).type).toBe("REVIEW"));
test("取消失败、重新确认和缺失订单号不能自动取消", () => {
  expect(classifyIwayMail(trusted("Transfer 949810 cancellation failed")).type).toBe("REVIEW");
  expect(classifyIwayMail(trusted("Transfer 949810 reconfirmed")).type).toBe("REVIEW");
  expect(classifyIwayMail({ ...trusted("Transfer has been cancelled"), text: "Please cancel this transfer" }).type).toBe("REVIEW");
});
test("本机助手只读取邮箱并提交统一服务，不含数据库或本地取消入口", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/import-future-iway-from-lark.mjs"), "utf8");
  expect(source).toContain("IWAY_LOCAL_SYNC_INGEST_URL");
  expect(source).toContain("IWAY_LOCAL_SYNC_ENABLED_AT");
  expect(source).not.toContain("PrismaClient");
  expect(source).not.toContain("db.order");
  expect(source).not.toContain("action === \"cancel\"");
});
