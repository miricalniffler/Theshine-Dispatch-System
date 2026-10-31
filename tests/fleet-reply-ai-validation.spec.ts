import { expect, test } from "@playwright/test";
import { sanitizeAiDriverName, sanitizeAiPlate } from "../src/features/fleet-replies/service";
import { normalizeLicensePlateForReturn, normalizeVehicleModel } from "../src/lib/rules/engine";
import { driverDetailForDisplay } from "../src/features/orders/driver-detail-display";

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

test("车型目录会将唯一型号统一为完整品牌加型号名称", () => {
  expect(normalizeVehicleModel("Yaris")).toBe("Toyota Yaris ATIV");
  expect(normalizeVehicleModel("Toyota Yaris ATIV")).toBe("Toyota Yaris ATIV");
  expect(normalizeVehicleModel("City")).toBe("Honda City");
  expect(normalizeVehicleModel("Xpander")).toBe("Mitsubishi Xpander");
  expect(normalizeVehicleModel("Carnival")).toBe("Kia Carnival");
});

test("Hiace 回传和人工保存时使用完整的 Toyota HiAce 车型名称", () => {
  expect(normalizeVehicleModel("Hiace")).toBe("Toyota HiAce");
  expect(normalizeVehicleModel("Toyota Hiace")).toBe("Toyota HiAce");
});

test("AI、人工录入和 iWay 回传共用目录，统一补足 Toyota 车型名称", () => {
  expect(normalizeVehicleModel("INOVA")).toBe("Toyota Innova");
  expect(normalizeVehicleModel("HiAce")).toBe("Toyota HiAce");
  expect(normalizeVehicleModel("Fortuner")).toBe("Toyota Fortuner");
  expect(normalizeVehicleModel("Camry")).toBe("Toyota Camry");
});

test("订单列表和订单详情在读取历史车型时规范化，但不写回旧记录", () => {
  const savedDetail = {
    confirmedDriverName: "AIM",
    normalizedDriverPhone: "0638701934",
    confirmedVehicleModel: "INOVA",
    confirmedVehicleType: "Minivan",
    confirmedLicensePlate: "7280",
  };

  expect(driverDetailForDisplay(savedDetail)).toEqual({
    ...savedDetail,
    confirmedVehicleModel: "Toyota Innova",
  });
  expect(savedDetail.confirmedVehicleModel).toBe("INOVA");
});

test("识别到的品牌可参与车型目录匹配，未知或矛盾信息不会编造", () => {
  expect(normalizeVehicleModel("V Class", undefined, "Mercedes")).toBe("Mercedes-Benz V-Class");
  expect(normalizeVehicleModel("City", undefined, "Toyota")).toBe("City");
  expect(normalizeVehicleModel("Mystery Shuttle")).toBe("Mystery Shuttle");
});
