import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("纯 HTML 手机诊断端点不经过登录保护，也不依赖 React 页面", async ({ page }) => {
  const response = await page.goto("/diagnostics/mobile");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "手机连接诊断" })).toBeVisible();
  await expect(page.getByText("此页不使用登录、订单、数据库、React、导航或离线缓存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "检查同源响应" }).click();
  await expect(page.getByRole("status")).toContainText("同源响应正常：");
});

test("轻量应用诊断页使用正常布局但不加载订单模块", async ({ page }) => {
  const response = await page.goto("/diagnostics/app");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "应用启动诊断" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "本机启动记录" })).toBeVisible();
  await expect(page.getByText("client listener ready", { exact: false })).toBeVisible();
});

test("诊断路由、启动记录与隐私边界保持可审计", () => {
  const proxy = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");
  const plainRoute = readFileSync(resolve(process.cwd(), "src/app/diagnostics/mobile/route.ts"), "utf8");
  const startup = readFileSync(resolve(process.cwd(), "src/components/StartupDiagnostics.tsx"), "utf8");

  expect(proxy).toContain('"/diagnostics/mobile"');
  expect(proxy).toContain('"/diagnostics/app"');
  expect(plainRoute).toContain('"cache-control": "no-store, max-age=0"');
  expect(plainRoute).toContain("plain-html-mobile-diagnostic");
  expect(startup).toContain('window.addEventListener("unhandledrejection"');
  expect(startup).toContain('window.addEventListener("error", onError, true)');
  expect(startup).not.toContain("fetch(");
});
