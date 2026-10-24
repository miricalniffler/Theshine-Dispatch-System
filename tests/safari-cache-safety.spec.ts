import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("兼容性 Service Worker 不缓存 Next 前端资源，并会清除旧缓存", () => {
  const source = readFileSync(resolve(process.cwd(), "public/service-worker.js"), "utf8");
  expect(source).toContain("LEGACY_CACHE_PREFIX");
  expect(source).toContain("caches.delete");
  expect(source).not.toContain('addEventListener("fetch"');
  expect(source).not.toContain("cache.put");
});

test("Playwright 保留 iPhone Safari 回归项目", () => {
  const source = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
  expect(source).toContain('name: "iphone-safari"');
  expect(source).toContain('browserName: "webkit"');
});

test("浏览器渲染异常有可见的恢复页面，而不是白屏", () => {
  const source = readFileSync(resolve(process.cwd(), "src/app/global-error.tsx"), "utf8");
  expect(source).toContain("暂时无法打开工作台");
  expect(source).toContain("重新加载");
  expect(source).toContain("回到登录页");
});

test("未登录页面也能更新根作用域兼容性 Service Worker", () => {
  const proxy = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");
  const registration = readFileSync(resolve(process.cwd(), "src/components/PwaRegistration.tsx"), "utf8");
  expect(proxy).toContain('"/service-worker.js"');
  expect(registration).toContain("/service-worker.js?rev=compat-v2");
  expect(registration).toContain("registration.update()");
});
