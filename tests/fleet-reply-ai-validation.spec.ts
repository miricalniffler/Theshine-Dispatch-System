import { expect, test } from "@playwright/test";
import { requiresManualVehicleConfirmation, sanitizeAiDriverName, sanitizeAiPlate } from "../src/features/fleet-replies/service";
import { normalizeLicensePlateForReturn, normalizeVehicleModel, resolveVehicleModel } from "../src/lib/rules/engine";

test("AI 结构化结果不允许把车牌或电话标签写入司机姓名", () => {
  expect(sanitizeAiDriverName("Mr.Krachit")).toBe("Mr.Krachit");
  expect(sanitizeAiDriverName("Car Plate :: ฮพ 5348 กรุงเทพ")).toBeNull();
  expect(sanitizeAiDriverName("Mobile :: 0923476125")).toBeNull();
});

test("AI 车牌结果保留泰文车牌原文，不折叠为数字", () => {
  expect(sanitizeAiPlate("Car Plate :: ฮพ 5348 กรุงเทพ")).toBe("ฮพ 5348 กรุงเทพ");
  expect(sanitizeAiPlate("Driver :: Mr.Krachit")).toBeNull();
});

test("i’way 回传保留完整泰文车牌，只整理多余空格", () => {
  expect(normalizeLicensePlateForReturn("  6ขท   1981 ")).toBe("6ขท 1981");
  expect(normalizeLicensePlateForReturn("61981")).toBe("61981");
});

test("AI 提供品牌和未收录的新车型时，完整品牌加型号会被直接保留", () => {
  expect(resolveVehicleModel("Sealion 7", "BYD")).toMatchObject({
    value: "BYD Sealion 7",
    needsManualReview: false,
  });
  expect(resolveVehicleModel("INOVA", "Toyota")).toMatchObject({
    value: "Toyota INOVA",
    needsManualReview: false,
  });
});

test("目录只做已知完整品牌车型的保守格式校验，不为缺失品牌补全", () => {
  expect(resolveVehicleModel("toyota camry", "Toyota")).toMatchObject({
    value: "Toyota Camry",
    needsManualReview: false,
  });
  expect(resolveVehicleModel("Camry")).toMatchObject({
    value: "Camry",
    needsManualReview: true,
  });
  expect(normalizeVehicleModel("INOVA")).toBe("INOVA");
});

test("AI 品牌缺失或冲突时保留原文并要求人工确认", () => {
  expect(resolveVehicleModel("Fortuner")).toMatchObject({
    value: "Fortuner",
    needsManualReview: true,
  });
  expect(resolveVehicleModel("Toyota Camry", "Honda")).toMatchObject({
    value: "Toyota Camry",
    needsManualReview: true,
  });
});

test("泰文和人工输入的完整车型原文在保存前规范化时不被截断或猜测", () => {
  expect(resolveVehicleModel("อินโนวา", "Toyota")).toMatchObject({
    value: "Toyota อินโนวา",
    needsManualReview: false,
  });
  expect(normalizeVehicleModel("Lexus LM 350h")).toBe("Lexus LM 350h");
});

test("已存历史车型不会在读取时被目录补写或降级", () => {
  expect(normalizeVehicleModel("Toyota Innova")).toBe("Toyota Innova");
  expect(normalizeVehicleModel("INOVA")).toBe("INOVA");
  expect(normalizeVehicleModel("BYD Sealion 7")).toBe("BYD Sealion 7");
});

test("服务端会要求明确人工确认 AI 标记为待复核的车型", () => {
  expect(requiresManualVehicleConfirmation({ needs_review: true })).toBe(true);
  expect(requiresManualVehicleConfirmation({ needs_review: false })).toBe(false);
  expect(requiresManualVehicleConfirmation(undefined)).toBe(false);
});
