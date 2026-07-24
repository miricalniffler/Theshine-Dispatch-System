import { loadRules } from "@/lib/rules/load-rules";
import { defaultLuggageCount, formatInternationalPhone, formatMeetGreetLine, renderDispatchBatchFooter, renderTemplate, validateRequiredFields } from "@/lib/rules/engine";
import { db } from "@/lib/db";

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
  pickupAddress: string;
  dropoffAddress: string;
  flightNumber: string | null;
  adults: number;
  children: number;
  luggage: number;
  meetGreetLine: string | null;
};

function contentFor(order: DispatchOrder, rules = loadRules()) {
  return {
    platform_order_number: order.orderNo,
    passenger_name: order.passengerName,
    passenger_phone: formatInternationalPhone(order.passengerPhone, rules) ?? order.passengerPhone,
    flight_number: order.flightNumber ?? "待核对",
    pickup_date: order.serviceDate,
    pickup_time: order.pickupTime,
    pickup_datetime: `${order.serviceDate} ${order.pickupTime}`,
    pickup_address: order.pickupAddress,
    dropoff_address: order.dropoffAddress,
    platform_vehicle_type: order.vehicleType,
    seat_count: order.vehicleType === "Van" ? 8 : null,
    adults: order.adults,
    children: order.children,
    luggage: defaultLuggageCount(order.luggage, order.adults, order.children, rules),
    child_seat_line: "",
    meet_greet_line: formatMeetGreetLine(order.meetGreetLine, order.passengerName, rules),
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

export type DispatchPreviewOptions = {
  /** A single-order inspection preview uses the same header/body but never adds a city batch footer. */
  includeBatchFooter?: boolean;
};

type StoredDispatchBatch = {
  id: string;
  orderIds: string[];
  text: string;
  ruleVersion: string;
  copiedAt: string;
  confirmedAt: string | null;
};

async function selectedDispatchOrders(orderIds: string[]) {
  const rows = await db.order.findMany({ where: { id: { in: orderIds } }, include: { fleet: true } });
  return rows.map((row) => ({
    id: row.id,
    orderNo: row.platformOrderNumber,
    serviceDate: row.serviceDate,
    pickupTime: row.pickupDateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }),
    city: row.city,
    fleetName: row.fleet?.name ?? "待选择",
    passengerName: row.passengerName,
    passengerPhone: row.passengerPhone,
    vehicleType: row.platformVehicleType,
    status: row.status,
    exceptions: [],
    pickupAddress: row.pickupAddress,
    dropoffAddress: row.dropoffAddress,
    flightNumber: row.flightNumber,
    adults: row.adults,
    children: row.children,
    luggage: row.luggage,
    meetGreetLine: row.meetGreetLine,
  }));
}

export async function createDispatchPreview(orderIds: string[], options: DispatchPreviewOptions = {}): Promise<DispatchPreview> {
  const rules = loadRules();
  const selected = await selectedDispatchOrders(orderIds);
  const errors: string[] = [];
  if (!selected.length) errors.push("请至少选择一张订单。");
  if (selected.length !== orderIds.length) errors.push("有订单不存在或不在当前可选范围内。");
  const includeBatchFooter = options.includeBatchFooter ?? true;
  const cities = new Set(selected.map((item) => item.city));
  const fleets = new Set(selected.map((item) => item.fleetName));
  const dates = new Set(selected.map((item) => item.serviceDate));
  if (selected.some((item) => item.fleetName === "待选择")) errors.push("所选订单尚未指定车队，请先在订单详情中选择车队。");
  if (includeBatchFooter && cities.size > 1) errors.push("批量派给车队时，请只选择同一城市的订单。");
  if (includeBatchFooter && fleets.size > 1) errors.push("批量派给车队时，请只选择同一车队的订单。");
  if (includeBatchFooter && dates.size > 1) errors.push("不同服务日期请拆成不同批次。");
  selected.forEach((order) => {
    if (order.status !== "READY_TO_DISPATCH") errors.push(`${order.orderNo} 当前不是待派单状态。`);
    if (order.exceptions.length) errors.push(`${order.orderNo} 存在异常，不能直接批量派单。`);
    const result = validateRequiredFields(contentFor(order, rules), "before_dispatch", rules);
    if (!result.valid) errors.push(`${order.orderNo} 缺少：${result.missingFields.join("、")}`);
  });
  if (errors.length) return { valid: false, errors, ruleVersion: rules.rules_version, orderCount: selected.length };

  const bodies = selected.map((order) => {
    const record = contentFor(order, rules);
    return [renderTemplate(rules.templates.dispatch.header, record), renderTemplate(rules.templates.dispatch.body, record)].filter(Boolean).join("\n");
  });
  const city = selected[0].city;
  return {
    valid: true,
    errors: [],
    text: includeBatchFooter
      ? `${bodies.join("\n\n---\n\n")}\n\n${renderDispatchBatchFooter(city, selected.length, rules)}`
      : bodies.join("\n\n---\n\n"),
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
  const selected = await selectedDispatchOrders(orderIds);
  const fleet = await db.fleet.findUnique({
    where: { name_city: { name: preview.fleetName!, city: preview.city! } },
  });
  if (!fleet) throw new Error("FLEET_NOT_FOUND");

  const batch = await db.dispatchBatch.create({
    data: {
      city: preview.city!,
      fleetId: fleet.id,
      serviceDate: preview.serviceDate!,
      ruleVersion: preview.ruleVersion,
      contentSnapshot: preview.text,
      copiedAt: new Date(),
      orders: { create: orderIds.map((orderId) => ({ orderId })) },
    },
  });
  return { ...preview, batchId: batch.id };
}

export async function confirmDispatch(batchId: string): Promise<StoredDispatchBatch> {
  const batch = await db.dispatchBatch.findUnique({
    where: { id: batchId },
    include: { orders: { select: { orderId: true } } },
  });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  const confirmedAt = batch.confirmedAt ?? new Date();
  const orderIds = batch.orders.map((link) => link.orderId);

  if (!batch.confirmedAt) {
    await db.$transaction([
      db.dispatchBatch.update({ where: { id: batch.id }, data: { confirmedAt } }),
      db.order.updateMany({ where: { id: { in: orderIds } }, data: { status: "DISPATCHED" } }),
      db.activityLog.createMany({
        data: orderIds.map((orderId) => ({
          orderId,
          action: "已确认派单",
          actor: "运营人员",
          metadata: JSON.stringify({ dispatchBatchId: batch.id, ruleVersion: batch.ruleVersion }),
        })),
      }),
    ]);
  }

  return {
    id: batch.id,
    orderIds,
    text: batch.contentSnapshot,
    ruleVersion: batch.ruleVersion,
    copiedAt: (batch.copiedAt ?? batch.createdAt).toISOString(),
    confirmedAt: confirmedAt.toISOString(),
  };
}
