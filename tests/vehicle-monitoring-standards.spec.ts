import { expect, test } from "@playwright/test";
import { INITIAL_VEHICLE_STANDARDS } from "../src/features/vehicle-monitoring/initial-standards";
import { countryCode, scopeMatches } from "../src/features/vehicle-monitoring/regions";
import { supportsCapacityCombination } from "../src/features/vehicle-monitoring/assessment-service";
import { normalizeVehicleKey } from "../src/features/vehicle-monitoring/standards-service";

test("Excel 初始标准完整保留 28 条来源记录，不把同车型的不同配置合并", () => {
  expect(INITIAL_VEHICLE_STANDARDS).toHaveLength(28);
  expect(new Set(INITIAL_VEHICLE_STANDARDS.map((item) => item.sourceKey)).size).toBe(28);
  const hiace = INITIAL_VEHICLE_STANDARDS.filter((item) => item.aliases.includes("Toyota Hiace"));
  expect(hiace.map((item) => [item.scope, item.passengers, item.luggage])).toEqual(expect.arrayContaining([
    ["TH_KH_VN_LK_NP", 8, 5], ["GLOBAL", 11, 6], ["GLOBAL", 13, 7],
  ]));
});

test("国家特殊规则优先所需的国家映射是显式的，欧洲不靠文本模糊匹配", () => {
  expect(countryCode("Thailand")).toBe("TH");
  expect(countryCode("泰国")).toBe("TH");
  expect(scopeMatches("TH_KH_VN_LK_NP", "TH")).toBe(true);
  expect(scopeMatches("TH_KH_VN_LK_NP", "FR")).toBe(false);
  expect(scopeMatches("EUROPE", "FR")).toBe(true);
  expect(scopeMatches("EUROPE", "TH")).toBe(false);
  expect(scopeMatches("GLOBAL", "TH")).toBe(true);
});

test("联合容量只允许已确认组合的明确向下兼容，不能跨配置猜测", () => {
  const fortuner = [{ passengers: 6, standardLuggage: 4, outcome: "SUPPORTED", isConfirmed: true, downwardCompatible: true }];
  expect(supportsCapacityCombination(fortuner, 6, 2)).toBe(true);
  expect(supportsCapacityCombination(fortuner, 4, 4)).toBe(true);
  expect(supportsCapacityCombination(fortuner, 6, 6)).toBe(false);
  expect(supportsCapacityCombination([{ ...fortuner[0], downwardCompatible: false }], 5, 3)).toBe(false);
});

test("车型别名规范化保留品牌与型号，但不会把内部等级当作平台等级", () => {
  expect(normalizeVehicleKey("Toyota Hiace")).toBe("toyota hiace");
  expect(normalizeVehicleKey("Mercedes-Benz V-Class")).toBe("mercedes benz v class");
  expect(INITIAL_VEHICLE_STANDARDS.some((item) => item.internalGrade === "舒适7座" && item.aliases.includes("Toyota Sienna"))).toBe(true);
});
