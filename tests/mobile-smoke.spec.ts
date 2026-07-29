import { expect, test } from "@playwright/test";

const password = process.env.E2E_TEAM_ACCESS_PASSWORD;
const accessToken = process.env.E2E_TEAM_ACCESS_TOKEN;

function isMobileProject(projectName: string) {
  return projectName !== "desktop-chrome";
}

async function expectNoDocumentOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth, "页面不应产生需要横向滚动的整体内容").toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

async function signIn(page: import("@playwright/test").Page) {
  if (accessToken) {
    await page.context().addCookies([{ name: "iway-team-access", value: accessToken, domain: "127.0.0.1", path: "/" }]);
    await page.goto("/orders");
    await page.waitForLoadState("domcontentloaded");
    return;
  }
  if (!password) throw new Error("缺少 E2E_TEAM_ACCESS_PASSWORD 或 E2E_TEAM_ACCESS_TOKEN；此测试不应运行。");
  await page.goto("/login");
  await page.getByLabel("团队访问密码").fill(password);
  await page.getByRole("button", { name: "进入系统" }).click({ noWaitAfter: true });
  await expect(page).toHaveURL(/\/orders(?:\?|$)/, { timeout: 12_000 });
}

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("最后页面截图", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("登录页在所有目标屏幕均可使用", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "接送机发单平台" })).toBeVisible();
  await expect(page.getByLabel("团队访问密码")).toBeVisible();
  await expect(page.getByRole("button", { name: "进入系统" })).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test.describe("已登录后的手机工作台", () => {
  test.skip(!password && !accessToken, "未配置测试登录信息；跳过需要登录的只读冒烟测试。");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("订单工作台可展开筛选且不产生页面横向溢出", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { name: "订单工作台" })).toBeVisible();

    if (isMobileProject(testInfo.project.name)) {
      const filterButton = page.getByRole("button", { name: /筛选订单|收起筛选/ });
      await expect(filterButton).toBeVisible();
      await filterButton.click();
      await expect(page.getByLabel("日期范围")).toBeVisible();
    }

    await expectNoDocumentOverflow(page);
  });

  test("手机可打开并关闭更多导航，不触发业务写入", async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), "桌面端不显示手机更多导航。");
    await page.getByLabel("打开更多功能").click();
    const sheet = page.getByRole("dialog", { name: "更多功能" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "历史订单" })).toBeVisible();
    await sheet.getByLabel("关闭更多功能").click();
    await expect(sheet).toBeHidden();
    await expectNoDocumentOverflow(page);
  });

  test("车队回传和 i’way 回传页面可在手机打开", async ({ page }) => {
    await page.goto("/driver-details");
    await expect(page.getByRole("heading", { name: /粘贴车队回复|把车队回复/ })).toBeVisible();
    await expectNoDocumentOverflow(page);

    await page.goto("/iway-return");
    await expect(page.getByRole("heading", { name: /明日订单一键回传|当天订单一键回传|i.?way 回传/ })).toBeVisible();
    await expectNoDocumentOverflow(page);
  });
});
