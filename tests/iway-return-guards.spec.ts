import { expect, test } from "@playwright/test";
import { isIwayPreviewCurrent } from "../src/features/iway/service";

test("司机或车辆资料变化后，已复制的 iway 回传草稿必须失效", () => {
  const copied = "Return for 20 Oct\n949810: Somchai, +66812345678, Toyota Commuter, 1กข 2345";
  expect(isIwayPreviewCurrent(copied, { valid: true, text: copied })).toBe(true);
  expect(isIwayPreviewCurrent(copied, { valid: true, text: copied.replace("1กข 2345", "2ขค 6789") })).toBe(false);
  expect(isIwayPreviewCurrent(copied, { valid: false })).toBe(false);
});
