import { demoOrderRepository } from "@/features/orders/demo-repository";
import type { Order } from "@/features/orders/types";
import { formatServiceDateLabel, normalizeThailandPhone, normalizeVehicleModel, renderTemplate, validateRequiredFields } from "@/lib/rules/engine";
import { loadRules } from "@/lib/rules/load-rules";

export type DriverDetails = {
  orderId: string;
  rawReply: string;
  confirmedDriverName: string | null;
  rawDriverPhone: string | null;
  normalizedDriverPhone: string | null;
  confirmedVehicleModel: string | null;
  licensePlate: string | null;
  confirmedAt: string | null;
};

export type DriverDetailsInput = Pick<DriverDetails, "rawReply" | "confirmedDriverName" | "rawDriverPhone" | "confirmedVehicleModel" | "licensePlate">;

type IwayBatch = { id: string; orderIds: string[]; serviceDate: string; text: string; ruleVersion: string; copiedAt: string | null; confirmedAt: string | null };

// The initial demo uses memory only. This module is intentionally the single persistence seam
// so it can be replaced by the schema's DriverDetail/IwayReturnBatch repositories later.
const details = new Map<string, DriverDetails>([
  ["ord_006", { orderId: "ord_006", rawReply: "Driver: Somchai / 081-234-5678 / Toyota Commut / 1กข 2345", confirmedDriverName: "Somchai", rawDriverPhone: "081-234-5678", normalizedDriverPhone: "+66812345678", confirmedVehicleModel: "Toyota Commuter", licensePlate: "1กข 2345", confirmedAt: new Date().toISOString() }],
]);
const batches = new Map<string, IwayBatch>();

function fieldLabels(fields: string[]) {
  const labels: Record<string, string> = { platform_order_number: "订单号", pickup_datetime: "接车时间", confirmed_vehicle_model: "确认车型", confirmed_driver_name: "司机姓名", normalized_driver_phone: "司机电话", license_plate: "车牌号" };
  return fields.map((field) => labels[field] ?? field);
}

function iwayContext(order: Order, driver: DriverDetails | undefined) {
  return {
    platform_order_number: order.orderNo,
    pickup_datetime: `${order.serviceDate} ${order.pickupTime}`,
    confirmed_vehicle_model: driver?.confirmedVehicleModel,
    confirmed_driver_name: driver?.confirmedDriverName,
    normalized_driver_phone: driver?.normalizedDriverPhone,
    license_plate: driver?.licensePlate,
  };
}

export async function listDriverWork() {
  const orders = await demoOrderRepository.list({ dateMode: "future" });
  return orders.filter((order) => order.status === "DISPATCHED" || order.status === "DRIVER_CONFIRMED" || order.status === "RETURNED").map((order) => ({ order, driver: details.get(order.id) ?? null }));
}

export async function getDriverDetails(orderId: string) { return details.get(orderId) ?? null; }

export async function saveDriverDetails(orderId: string, input: DriverDetailsInput) {
  const order = await demoOrderRepository.getById(orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const rules = loadRules();
  const normalizedDriverPhone = normalizeThailandPhone(input.rawDriverPhone, rules);
  const record: DriverDetails = {
    orderId,
    rawReply: input.rawReply?.trim() ?? "",
    confirmedDriverName: input.confirmedDriverName?.trim() || null,
    rawDriverPhone: input.rawDriverPhone?.trim() || null,
    normalizedDriverPhone,
    confirmedVehicleModel: normalizeVehicleModel(input.confirmedVehicleModel, rules),
    licensePlate: input.licensePlate?.trim() || null,
    confirmedAt: null,
  };
  const check = validateRequiredFields(iwayContext(order, record), "before_iway_return", rules);
  if (check.valid) {
    record.confirmedAt = new Date().toISOString();
    await demoOrderRepository.updateStatus(orderId, "DRIVER_CONFIRMED");
  }
  details.set(orderId, record);
  return { driver: record, valid: check.valid, missingFields: fieldLabels(check.missingFields), ruleVersion: rules.rules_version };
}

export type IwayPreview = { valid: boolean; errors: string[]; text?: string; orderCount: number; serviceDate?: string; ruleVersion: string };

export async function createIwayPreview(orderIds: string[]): Promise<IwayPreview> {
  const rules = loadRules();
  const selected = await demoOrderRepository.getByIds(orderIds);
  const errors: string[] = [];
  if (!selected.length) errors.push("请至少选择一张订单。");
  if (selected.length !== orderIds.length) errors.push("有订单不存在。");
  const dates = new Set(selected.map((order) => order.serviceDate));
  if (dates.size > 1) errors.push("i’way 回传只能合并同一服务日的订单。");
  selected.forEach((order) => {
    if (order.status !== "DRIVER_CONFIRMED" && order.status !== "RETURNED") errors.push(`${order.orderNo} 尚未确认完整司机资料。`);
    const check = validateRequiredFields(iwayContext(order, details.get(order.id)), "before_iway_return", rules);
    if (!check.valid) errors.push(`${order.orderNo} 缺少：${fieldLabels(check.missingFields).join("、")}`);
  });
  if (errors.length) return { valid: false, errors, orderCount: selected.length, ruleVersion: rules.rules_version };
  const serviceDate = selected[0].serviceDate;
  const bodies = selected.map((order) => renderTemplate(rules.templates.iway_return.body, iwayContext(order, details.get(order.id))));
  const text = [renderTemplate(rules.templates.iway_return.header, { service_date_label_en: formatServiceDateLabel(serviceDate, "en") }), ...bodies, rules.templates.iway_return.footer].join("\n\n");
  return { valid: true, errors: [], text, orderCount: selected.length, serviceDate, ruleVersion: rules.rules_version };
}

export async function saveIwayCopy(orderIds: string[]) {
  const preview = await createIwayPreview(orderIds);
  if (!preview.valid || !preview.text || !preview.serviceDate) return preview;
  const id = `iway_${Date.now()}`;
  batches.set(id, { id, orderIds, serviceDate: preview.serviceDate, text: preview.text, ruleVersion: preview.ruleVersion, copiedAt: new Date().toISOString(), confirmedAt: null });
  return { ...preview, batchId: id };
}

export async function confirmIwayReturn(batchId: string) {
  const batch = batches.get(batchId);
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  batch.confirmedAt = new Date().toISOString();
  await Promise.all(batch.orderIds.map((id) => demoOrderRepository.updateStatus(id, "COMPLETED")));
  return batch;
}
