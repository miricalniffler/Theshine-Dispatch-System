import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { hasTeamAccess } from "../src/lib/team-access";
import { applyConfirmedArchiveDefaults, resolveDriverNameSource } from "../src/features/iway/service";
import { normalizeVehicleArchivePlate, shouldPreserveConfirmedArchive } from "../src/features/vehicles/archive-service";
import { normalizeDriverScreenshot } from "../src/features/assist/driver-screenshot";

test("未知系统姓名保持阻断；可见泰文姓名的音译可直接用于回传", () => {
  expect(resolveDriverNameSource("SYSTEM_GENERATED", "MANUAL", false)).toBe("SYSTEM_GENERATED");
  expect(resolveDriverNameSource("IMAGE_TRANSLITERATED", "MANUAL", false)).toBe("IMAGE_TRANSLITERATED");
  expect(resolveDriverNameSource(null, "IMAGE_TRANSLITERATED", false)).toBe("IMAGE_TRANSLITERATED");
  expect(resolveDriverNameSource("SYSTEM_GENERATED", "MANUAL", true)).toBe("MANUAL");
});

test("已确认车辆档案只补全空车型，绝不覆盖当前订单明确填写值", () => {
  const archive = { confirmationStatus: "CONFIRMED", model: "Toyota Commuter", brand: "Toyota", vehicleClass: "Minivan" };
  expect(applyConfirmedArchiveDefaults({ confirmedVehicleModel: null }, archive)).toEqual({ confirmedVehicleModel: "Toyota Commuter", filledFromArchive: true });
  expect(applyConfirmedArchiveDefaults({ confirmedVehicleModel: "Toyota HiAce" }, archive)).toEqual({ confirmedVehicleModel: "Toyota HiAce", filledFromArchive: false });
  expect(applyConfirmedArchiveDefaults({ confirmedVehicleModel: null }, { ...archive, confirmationStatus: "SUGGESTED" })).toEqual({ confirmedVehicleModel: null, filledFromArchive: false });
});

test("已确认车辆档案保留原始资料并把不同车型标为冲突", () => {
  const existing = { confirmationStatus: "CONFIRMED", rawPlate: "1กข 1234", brand: "Toyota", model: "Commuter", vehicleClass: "Van" };
  expect(normalizeVehicleArchivePlate("1 กข-1234")).toBe("1กข1234");
  expect(shouldPreserveConfirmedArchive(existing, { rawPlate: "1กข1234", brand: "Toyota", model: "HiAce", vehicleClass: "Van" })).toEqual({ preserve: true, conflict: true });
});

test("敏感接口的显式鉴权不依赖 Proxy 跳转", () => {
  const before = process.env.TEAM_ACCESS_TOKEN;
  process.env.TEAM_ACCESS_TOKEN = "test-token";
  expect(hasTeamAccess(new NextRequest("http://localhost/api/vehicle-archive", { headers: { cookie: "iway-team-access=test-token" } }))).toBe(true);
  expect(hasTeamAccess(new NextRequest("http://localhost/api/vehicle-archive"))).toBe(false);
  if (before === undefined) delete process.env.TEAM_ACCESS_TOKEN; else process.env.TEAM_ACCESS_TOKEN = before;
});

test("车辆识别缺少可见证据时不编造司机姓名或车辆资料", () => {
  const result = normalizeDriverScreenshot({ driver_name: "Somchai", vehicle_brand: "Toyota", confidence: "LOW", evidence: ["画面模糊"] }, "MOCK", "mock", null);
  expect(result.driverName).toBeNull();
  expect(result.driverNameSource).toBe("NOT_FOUND");
  expect(result.vehicleBrand).toBe("Toyota");
  expect(result.vehicleModel).toBeNull();
  expect(result.confidence).toBe("LOW");
});

test("车辆识别只接受已标明截图转写来源的司机姓名", () => {
  const result = normalizeDriverScreenshot({ driver_name: "Somchai", driver_name_thai: "สมชาย", driver_name_source: "IMAGE_TRANSLITERATED", vehicle_model: "Toyota Commuter", vehicle_class: "Minivan", confidence: "HIGH", evidence: ["车尾 Toyota 标识", "车型铭牌"] }, "MOCK", "mock", null);
  expect(result.driverName).toBe("Somchai");
  expect(result.rawThaiDriverName).toBe("สมชาย");
  expect(result.driverNameSource).toBe("IMAGE_TRANSLITERATED");
  expect(result.evidence).toEqual(["车尾 Toyota 标识", "车型铭牌"]);
});

test("直接可见英文司机姓名与泰文音译都保留图像来源", () => {
  const result = normalizeDriverScreenshot({ driver_name: "Niran", driver_name_source: "IMAGE_ENGLISH" }, "MOCK", "mock", null);
  expect(result.driverName).toBe("Niran");
  expect(result.driverNameSource).toBe("IMAGE_TRANSLITERATED");
  expect(result.rawThaiDriverName).toBeNull();
});
