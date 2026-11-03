import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("吉隆坡基础车队引导脚本只允许显式创建固定车队", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/bootstrap-kuala-lumpur-fleet.mjs"), "utf8");
  expect(source).toContain('name: "吉隆坡车队", city: "吉隆坡"');
  expect(source).toContain('process.argv.includes("--apply")');
  expect(source).toContain('db.fleet.findUnique');
  expect(source).toContain('db.fleet.create');
  expect(source).not.toContain("fleet.upsert");
});
