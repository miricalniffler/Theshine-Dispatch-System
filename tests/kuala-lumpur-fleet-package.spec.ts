import { expect, test } from "@playwright/test";
import { applyFleetPackage, type CandidateOrder, type ReplyRecord } from "../src/features/fleet-replies/service";
import type { FleetPackageVision } from "../src/features/assist/vision";

const orders: CandidateOrder[] = [
  { id: "a", orderNo: "1052074", passengerName: "A", pickup: "2026-11-05 08:00", route: "A → B", city: "吉隆坡", fleetName: "KL" },
  { id: "b", orderNo: "998533", passengerName: "B", pickup: "2026-11-05 09:00", route: "A → B", city: "吉隆坡", fleetName: "KL" },
];

function record(): ReplyRecord {
  return { source_index: 0, order_match: { platform_order_number: null, confidence: "low", evidence: "" }, driver_name: { value: null, evidence: "" }, driver_phone: { value: null, evidence: "" }, license_plate: { value: null, evidence: "" }, vehicle_category: { value: null, evidence: "" }, vehicle_brand: { value: null, evidence: "" }, vehicle_model_raw: { value: null, evidence: "" }, vehicle_model: { value: null, evidence: "" }, image_source_index: null, needs_review: true, review_reasons: ["缺少可匹配的订单号"] };
}
function vision(rows: FleetPackageVision["records"]): FleetPackageVision { return { provider: "GLM", note: "test", records: rows }; }
function row(overrides: Partial<FleetPackageVision["records"][number]> = {}): FleetPackageVision["records"][number] {
  return { order_number: null, driver_name: null, driver_name_source: "UNKNOWN", driver_phone: null, license_plate: null, vehicle_brand: null, vehicle_model: null, vehicle_category: null, vehicle_color: null, confirmation_status: "UNKNOWN", source_image_indexes: [1], confidence: "HIGH", ...overrides };
}

test("单一精确订单可把另一张图片的司机车辆资料安全并入同一资料包", () => {
  const records = [record()];
  applyFleetPackage(records, vision([row({ order_number: "1052074" }), row({ driver_name: "Gary", driver_phone: "+60 12-345 6789", license_plate: "DDN3323", vehicle_brand: "Proton", vehicle_model: "Persona", vehicle_color: "Grey", source_image_indexes: [2] })]), orders);
  expect(records[0]).toMatchObject({ order_match: { platform_order_number: "1052074" }, driver_name: { value: "Gary" }, driver_phone: { value: "+60 12-345 6789" }, license_plate: { value: "DDN3323" }, vehicle_brand: { value: "Proton" }, vehicle_color: { value: "Grey" } });
});

test("电子钱包姓名只作为候选，且未知车型不会被编造", () => {
  const records = [record()];
  applyFleetPackage(records, vision([row({ order_number: "1169889", source_image_indexes: [1] }), row({ driver_name: "LAU CHIT WAH", driver_name_source: "EWALLET_PAYEE", vehicle_brand: "Toyota", license_plate: "VEF7195", vehicle_color: "Black", source_image_indexes: [2, 3] })]), [{ ...orders[0], id: "c", orderNo: "1169889" }]);
  expect(records[0].driver_name.value).toBe("LAU CHIT WAH");
  expect(records[0].vehicle_brand.value).toBe("Toyota");
  expect(records[0].vehicle_model.value).toBeNull();
  expect(records[0].needs_review).toBe(true);
});

test("同一资料包多套司机资料时不自动放行", () => {
  const records = [record()];
  applyFleetPackage(records, vision([row({ order_number: "998533", driver_name: "Hew Nyun Lien", driver_phone: "+60 12 111 1111" }), row({ order_number: "998533", driver_name: "Other Driver", driver_phone: "+60 12 222 2222", source_image_indexes: [2] })]), orders);
  expect(records[0].needs_review).toBe(true);
  expect(records[0].review_reasons).toContain("同一资料包出现多套司机或车辆资料，不能自动保存");
});

test("多个订单不会把无订单号的资料自动串到任一订单", () => {
  const records = [record(), record()];
  applyFleetPackage(records, vision([row({ order_number: "1052074" }), row({ order_number: "998533" }), row({ driver_name: "Unassigned", license_plate: "ABC1234", source_image_indexes: [3] })]), orders);
  expect(records.filter((item) => item.driver_name.value === "Unassigned" && item.order_match.platform_order_number)).toHaveLength(0);
  expect(records.find((item) => item.driver_name.value === "Unassigned")?.needs_review).toBe(true);
});

test('原文已精确匹配唯一订单，图片不重复订单号也能补齐字段', () => {
 const records=[record()]; records[0].order_match={platform_order_number:'1052074',confidence:'high',evidence:'exact text'};
 applyFleetPackage(records,vision([row({driver_name:'Gary',driver_phone:'+60176543323',license_plate:'DDN3323',vehicle_brand:'Proton',vehicle_model:'Persona'})]),orders);
 expect(records[0].driver_name.value).toBe('Gary');
 expect(records[0].vehicle_model.value).toBe('Proton Persona');
});

test('未知订单号的图片不能归属到另一笔已知订单', () => {
 const records=[record()]; records[0].order_match={platform_order_number:'1052074',confidence:'high',evidence:'exact text'};
 applyFleetPackage(records,vision([row({order_number:'9999999',driver_name:'Other Driver'})]),orders);
 expect(records[0].driver_name.value).toBeNull();
});
