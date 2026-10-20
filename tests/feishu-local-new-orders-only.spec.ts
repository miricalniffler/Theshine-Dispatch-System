import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("本机助手不直接写入订单，必须交给统一的安全邮件服务", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/import-future-iway-from-lark.mjs"), "utf8");
  expect(source).toContain("IWAY_LOCAL_SYNC_ENABLED_AT");
  expect(source).toContain("IWAY_LOCAL_SYNC_INGEST_URL");
  expect(source).toContain("Authorization: `Bearer ${ingestToken}`");
  expect(source).not.toContain("PrismaClient");
  expect(source).not.toContain("db.order");
  expect(source).not.toContain('status: "CANCELLED"');
  expect(source).not.toContain("fleet.upsert");
});
