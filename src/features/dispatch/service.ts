import { loadRules } from "@/lib/rules/load-rules";
import { renderDispatchBatchFooter, renderTemplate, validateRequiredFields } from "@/lib/rules/engine";
import { demoOrderRepository } from "@/features/orders/demo-repository";

type DispatchOrder = {
  id: string;
  orderNo: string;
  serviceDate: string;
  pickupTime: string;
  city: string;
  fleetName: string;
  passengerName: string;
  passengerPhone: string;
  vehicleType: string;
  status: string;
  exceptions: string[];
};

function contentFor(order: DispatchOrder) {
  return {
    platform_order_number: order.orderNo,
    passenger_name: order.passengerName,
    passenger_phone: order.passengerPhone,
    flight_number: order.city === "曼谷" ? "TG 641" : "PG 124",
    pickup_date: order.serviceDate,
    pickup_time: order.pickupTime,
    pickup_datetime: `${order.serviceDate} ${order.pickupTime}`,
    pickup_address: order.city === "曼谷" ? "Suvarnabhumi Airport (BKK), Gate 3" : "Samui Airport (USM), Arrival Hall",
    dropoff_address: order.city === "曼谷" ? "Sukhumvit 24, Bangkok" : "Chaweng Beach Road, Koh Samui",
    platform_vehicle_type: order.vehicleType,
    seat_count: order.vehicleType === "Van" ? 8 : null,
    adults: 2,
    children: 0,
    luggage: 2,
    child_seat_line: "",
    meet_greet_line: "",
    other_notes: "",
  };
}

export type DispatchPreview = {
  valid: boolean;
  errors: string[];
  text?: string;
  city?: string;
  fleetName?: string;
  serviceDate?: string;
  ruleVersion: string;
  orderCount: number;
};

type DispatchBatch = {
  id: string;
  orderIds: string[];
  text: string;
  ruleVersion: string;
  copiedAt: string;
  confirmedAt: string | null;
};

const dispatchBatches = new Map<string, DispatchBatch>();

export async function createDispatchPreview(orderIds: string[]): Promise<DispatchPreview> {
  const rules = loadRules();
  const all = await demoOrderRepository.list({ dateMode: "future" });
  const selected = all.filter((order) => orderIds.includes(order.id)) as DispatchOrder[];
  const errors: string[] = [];
  if (!selected.length) errors.push("请至少选择一张订单。");
  if (selected.length !== orderIds.length) errors.push("有订单不存在或不在当前可选范围内。");
  const cities = new Set(selected.map((item) => item.city));
  const fleets = new Set(selected.map((item) => item.fleetName));
  const dates = new Set(selected.map((item) => item.serviceDate));
  if (cities.size > 1) errors.push("批量派给车队时，请只选择同一城市的订单。");
  if (fleets.size > 1) errors.push("批量派给车队时，请只选择同一车队的订单。");
  if (dates.size > 1) errors.push("不同服务日期请拆成不同批次。");
  selected.forEach((order) => {
    if (order.status !== "READY_TO_DISPATCH") errors.push(`${order.orderNo} 当前不是待派单状态。`);
    if (order.exceptions.length) errors.push(`${order.orderNo} 存在异常，不能直接批量派单。`);
    const result = validateRequiredFields(contentFor(order), "before_dispatch", rules);
    if (!result.valid) errors.push(`${order.orderNo} 缺少：${result.missingFields.join("、")}`);
  });
  if (errors.length) return { valid: false, errors, ruleVersion: rules.rules_version, orderCount: selected.length };

  const bodies = selected.map((order) => {
    const record = contentFor(order);
    return [renderTemplate(rules.templates.dispatch.header, record), renderTemplate(rules.templates.dispatch.body, record)].filter(Boolean).join("\n");
  });
  const city = selected[0].city;
  return {
    valid: true,
    errors: [],
    text: `${bodies.join("\n\n---\n\n")}\n\n${renderDispatchBatchFooter(city, selected.length, rules)}`,
    city,
    fleetName: selected[0].fleetName,
    serviceDate: selected[0].serviceDate,
    ruleVersion: rules.rules_version,
    orderCount: selected.length,
  };
}

export async function saveDispatchCopy(orderIds: string[]) {
  const preview = await createDispatchPreview(orderIds);
  if (!preview.valid || !preview.text) return preview;
  const id = `dispatch_${Date.now()}`;
  dispatchBatches.set(id, { id, orderIds, text: preview.text, ruleVersion: preview.ruleVersion, copiedAt: new Date().toISOString(), confirmedAt: null });
  return { ...preview, batchId: id };
}

export async function confirmDispatch(batchId: string) {
  const batch = dispatchBatches.get(batchId);
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  batch.confirmedAt = new Date().toISOString();
  await Promise.all(batch.orderIds.map((id) => demoOrderRepository.updateStatus(id, "DISPATCHED")));
  return batch;
}
