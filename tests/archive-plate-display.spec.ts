import { expect, test } from "@playwright/test";
import { labelledPlateFromRawReply } from "../src/features/archives/service";

test("旧档案可以只读展示原始车队回复中的完整泰文车牌", () => {
  expect(labelledPlateFromRawReply("Car Plate :: ฮพ 5348 กรุงเทพ\nMobile :: 0923476125")).toBe("ฮพ 5348 กรุงเทพ");
});

test("未带车牌标签的原始回复不会被猜测为车牌", () => {
  expect(labelledPlateFromRawReply("Driver :: Mr.Krachit\nMobile :: 0923476125")).toBeNull();
});
