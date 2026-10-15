import { expect, test } from "@playwright/test";

// This is deliberately opt-in: it writes only to an explicitly supplied,
// disposable E2E database. It must never be pointed at Preview or Production.
const enabled = process.env.RUN_CORE_E2E === "true";
const token = process.env.E2E_TEAM_ACCESS_TOKEN;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";
const suffix = `${Date.now()}`;
const orderA = `E2E-${suffix}-A`;
const orderB = `E2E-${suffix}-B`;

function tomorrowBangkok() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const tomorrow = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1));
  return `${String(tomorrow.getUTCDate()).padStart(2, "0")}/${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}/${tomorrow.getUTCFullYear()}`;
}

function esfortyText(orderNo: string, passenger: string) {
  const digits = orderNo.replace(/\D/g, "").slice(-6).padStart(6, "0");
  const groupedOrder = `1 ${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${groupedOrder}
+66 81 234 5678
${passenger} (2 pax)
${tomorrowBangkok()} 09:30
C
Suvarnabhumi Airport, Bangkok
Flight: TG123
Sukhumvit 24, Bangkok
Meet & Greet`;
}

test.describe("隔离数据库的核心订单业务流程", () => {
  test.skip(!enabled || !token, "仅在显式指定的隔离 E2E 数据库中运行");
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: "iway-team-access", value: token!, url: baseUrl, httpOnly: true, sameSite: "Lax" }]);
  });

  async function importOrder(page: import("@playwright/test").Page, orderNo: string, passenger: string) {
    await page.goto("/import");
    // Type rather than setting the DOM value directly: this verifies that the
    // real React change handler enables the recognition action for an operator.
    await page.getByLabel("订单原文").pressSequentially(esfortyText(orderNo, passenger));
    await page.getByRole("button", { name: "识别订单字段" }).click();
    await expect(page.getByText("字段已按网站规则整理。请核对后保存。")).toBeVisible();
    // The compact test text uses a human-safe prefix, so restore its exact
    // unique order number after the parser has demonstrated recognition.
    await page.getByLabel("订单号").fill(orderNo);
    await page.getByRole("button", { name: "确认并保存订单" }).click();
    await expect(page.getByText("笔订单已保存", { exact: false })).toBeVisible();
  }

  test("导入、编辑、备注、取消，以及取消后拒绝编辑", async ({ page }) => {
    await importOrder(page, orderA, "E2E Passenger A");
    await page.goto("/orders");
    await page.getByLabel("关键词").fill(orderA);
    await expect(page.getByRole("link", { name: orderA })).toBeVisible();
    const href = await page.getByRole("link", { name: orderA }).getAttribute("href");
    await page.goto(href!);
    await page.getByLabel("其他备注").fill("E2E 编辑验证备注");
    await page.getByRole("button", { name: "保存订单" }).click();
    await expect(page.getByText("已保存订单信息", { exact: false })).toBeVisible();
    await page.getByLabel("异常备注").fill("E2E 异常备注需保留");
    await page.getByRole("button", { name: "保存异常备注" }).click();
    await page.reload();
    await page.getByRole("button", { name: "查看操作记录" }).click();
    await expect(page.getByText("E2E 异常备注需保留")).toBeVisible();
    await page.getByLabel("取消原因").fill("E2E 取消验证");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "确认取消订单" }).click();
    await expect(page.getByText("订单已取消", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存订单" })).toBeDisabled();
  });

  test("派单确认、司机资料、iWay 复制，以及取消后拒绝确认旧批次", async ({ page, context }) => {
    await importOrder(page, orderB, "E2E Passenger B");
    await page.goto("/orders");
    await page.getByLabel("关键词").fill(orderB);
    await expect(page.getByLabel(`选择 ${orderB}`)).toBeVisible();
    const detailHref = await page.getByRole("link", { name: orderB }).getAttribute("href");
    await page.getByLabel(`选择 ${orderB}`).check();
    await page.getByRole("button", { name: "批量生成车队派单" }).click();
    await expect(page.getByRole("button", { name: "复制派单文本" })).toBeVisible();
    await page.getByRole("button", { name: "复制派单文本" }).click();
    await expect(page.getByRole("button", { name: "我已派单，确认状态" })).toBeEnabled();
    await page.getByRole("button", { name: "我已派单，确认状态" }).click();
    await expect(page.getByRole("button", { name: "已确认派单" })).toBeVisible();
    await page.goto("/driver-details");
    await expect(page.getByText(orderB)).toBeVisible();
    await page.getByLabel("司机姓名").fill("E2E Driver");
    await page.getByLabel("司机电话").fill("0812345678");
    await page.getByLabel("确认车型").fill("Toyota Commuter");
    await page.getByLabel("车牌号").fill("1กข 2345");
    await page.getByRole("button", { name: "保存并校验" }).click();
    await expect(page.getByText("资料完整，订单已进入待回传。")).toBeVisible();
    await page.goto("/iway-return");
    await page.getByLabel(`选择 ${orderB}`).check();
    await page.getByRole("button", { name: "生成所选订单预览" }).click();
    await expect(page.getByText("i’way 正确格式")).toBeVisible();
    await page.getByRole("button", { name: "复制回传内容" }).click();
    await expect(page.getByRole("button", { name: "我已在 i’way 发送，确认回传" })).toBeEnabled();

    const cancelPage = await context.newPage();
    await cancelPage.goto(detailHref!);
    await cancelPage.getByLabel("取消原因").fill("E2E 回传批次并发取消");
    cancelPage.once("dialog", (dialog) => dialog.accept());
    await cancelPage.getByRole("button", { name: "确认取消订单" }).click();
    await expect(cancelPage.getByText("订单已取消", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "我已在 i’way 发送，确认回传" }).click();
    await expect(page.getByText("批次中有订单已取消或状态已变化，未完成回传。请重新生成。")).toBeVisible();
    await cancelPage.close();
  });

  test("飞书同步状态与订单读取接口可用", async ({ page }) => {
    const status = await page.request.get("/api/import-sync/feishu-mail");
    expect(status.ok()).toBeTruthy();
    const payload = await status.json();
    expect(payload.data.syncMode).toBe("local-scheduled");
    await page.goto("/orders");
    await page.getByLabel("关键词").fill(orderA);
    await expect(page.getByText(orderA)).toBeVisible();
  });
});
