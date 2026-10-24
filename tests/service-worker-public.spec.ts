import { expect, test } from "@playwright/test";

test("未登录状态可直接取得兼容性 Service Worker", async ({ page }) => {
  const response = await page.goto("/service-worker.js?rev=compat-v2");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"]).toContain("javascript");
  await expect(page.locator("body")).toContainText("LEGACY_CACHE_PREFIX");
});

test("登录页可安装当前兼容性 Service Worker", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "接送机发单平台" })).toBeVisible();
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration("/")));
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration?.active?.scriptURL ?? registration?.installing?.scriptURL ?? registration?.waiting?.scriptURL ?? null;
  });
  expect(worker).toContain("/service-worker.js?rev=compat-v2");
});
