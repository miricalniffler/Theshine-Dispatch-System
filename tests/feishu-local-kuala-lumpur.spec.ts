import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cityFromIwayOrder, serviceTimeZoneForLocalSync } from "../scripts/iway-local-sync-city.mjs";

test("本机飞书同步把吉隆坡机场接送和市区点对点归属到吉隆坡", () => {
  expect(cityFromIwayOrder("Kuala Lumpur", "KLIA2", "Petaling Jaya, Malaysia")).toBe("吉隆坡");
  expect(cityFromIwayOrder("", "Bukit Bintang, Kuala Lumpur", "Shah Alam, Malaysia")).toBe("吉隆坡");
  expect(serviceTimeZoneForLocalSync("吉隆坡")).toBe("Asia/Kuala_Lumpur");
});

test("本机飞书同步不会仅凭机场代码猜测地区", () => {
  expect(cityFromIwayOrder("", "KUL", "Airport hotel")).toBeNull();
  expect(cityFromIwayOrder("", "KLIA, Malaysia", "Bangkok, Thailand")).toBeNull();
});

test("本机飞书同步仍通过邮件 ID 和订单号保护重复导入", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/import-future-iway-from-lark.mjs"), "utf8");
  expect(source).toContain("knownIds.has(mail.message_id)");
  expect(source).toContain("if (existing) { summary.unchanged.push(item.orderNo); continue; }");
  expect(source).toContain('for (const city of ["曼谷", "苏梅", "吉隆坡"])');
});
