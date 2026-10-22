import { expect, test } from "@playwright/test";
import { sanitizeAiDriverName, sanitizeAiPlate } from "../src/features/fleet-replies/service";
import { normalizeVehicleModel } from "../src/lib/rules/engine";

test("AI 结构化结果不允许把车牌或电话标签写入司机姓名", () => {
  expect(sanitizeAiDriverName("Mr.Krachit")).toBe("Mr.Krachit");
  expect(sanitizeAiDriverName("Car Plate :: ฮพ 5348 กรุงเทพ")).toBeNull();
  expect(sanitizeAiDriverName("Mobile :: 0923476125")).toBeNull();
});

test("AI 车牌结果保留泰文车牌原文，不折叠为数字", () => {
  expect(sanitizeAiPlate("Car Plate :: ฮพ 5348 กรุงเทพ")).toBe("ฮพ 5348 กรุงเทพ");
  expect(sanitizeAiPlate("Driver :: Mr.Krachit")).toBeNull();
});

test("Yaris 回传时使用完整的 Toyota Yaris ATIV 车型名称", () => {
  expect(normalizeVehicleModel("Yaris")).toBe("Toyota Yaris ATIV");
  expect(normalizeVehicleModel("Toyota Yaris ATIV")).toBe("Toyota Yaris ATIV");
});
