import { test, expect } from "@playwright/test";

test("批量结果展示全部订单，并可逐笔确认待核对车型", async ({ page }) => {
  await page.context().addCookies([{ name: "iway-team-access", value: "batch-test-token", url: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100" }]);
  const numbers = ["1136594", "1105474", "1094978", "1169322"];
  const orders = numbers.map((orderNo, index) => ({ id: `order-${index}`, orderNo, passengerName: "Test", pickup: "2026-11-11 12:00", route: "Test", city: "吉隆坡", fleetName: "Test" }));
  const field = (value: string | null) => ({ value, evidence: "测试" });
  const records = numbers.map((number, index) => ({
    source_index: index, order_match: { platform_order_number: number, confidence: "high", evidence: "原文订单号" },
    driver_name: field(index ? "Pat Arkin" : "Denis Chen"), driver_phone: field(index ? "+60162739483" : "+601133208350"),
    license_plate: field(index ? "Vkk5015" : "W 3497 R"), vehicle_category: field(null), vehicle_brand: field(index ? null : "Nissan"),
    vehicle_model: field(index ? "Aruz Silver" : "Nissan Almera"), vehicle_model_raw: field(index ? "Aruz Silver" : "Almera"), image_source_index: null,
    needs_review: index > 0, review_reasons: index ? ["车型缺少可确认的品牌，请人工确认"] : [],
  }));
  const confirmed: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/fleet-replies/dates") data = { defaultDate: "2026-11-11", dates: ["2026-11-11"] };
    else if (path === "/api/driver-details") data = [];
    else if (path === "/api/fleet-replies") data = { id: "reply-test" };
    else if (path.endsWith("/analyze")) data = { status: "SUCCEEDED", extractionId: "extraction-test", orders, result: { records, unmatched_items: [], recognition: { label: "测试识别", note: "" } } };
    else if (path.endsWith("/confirm")) { const body = route.request().postDataJSON(); confirmed.push(body.records[0].orderId); data = { valid: true }; }
    else if (path.endsWith("/preview")) data = { valid: true, text: "测试回传内容" };
    await route.fulfill({ json: { data } });
  });
  const loaded = page.waitForResponse((response) => response.url().endsWith("/api/fleet-replies/dates"));
  await page.goto("/driver-details");
  await loaded;
  await page.getByLabel("车队原始回复（完整保留）").fill("测试四笔订单");
  await page.getByRole("button", { name: /整理并匹配/ }).click();
  await expect(page.getByRole("heading", { name: "② 识别结果（4 笔）" })).toBeVisible();
  for (const number of numbers) await expect(page.locator(".fleet-reply-recognized article").filter({ hasText: number })).toBeVisible();
  await expect(page.getByText("需要人工核对", { exact: true })).toHaveCount(3);
  expect(confirmed).toEqual(["order-0"]);
  for (const box of await page.getByText("我已人工核对车型及品牌").all()) await box.click();
  await page.getByRole("button", { name: "保存修改并重新生成回传" }).click();
  await expect.poll(() => confirmed.length).toBe(5); // first auto-saved, then four manually saved
  await expect(page.getByText("需要人工核对", { exact: true })).toHaveCount(0);
  await expect(page.getByText("已保存", { exact: true })).toHaveCount(4);
});
