import { db } from "@/lib/db";
import type { DriverDetail, Order as PersistedOrder } from "@prisma/client";
import type { Order } from "@/features/orders/types";
import { formatServiceDateLabel, normalizeLicensePlateForReturn, normalizeThailandPhone, normalizeVehicleModel, renderTemplate, validateRequiredFields } from "@/lib/rules/engine";
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
type OrderWithDriver = PersistedOrder & { driverDetail: DriverDetail | null; fleet?: { name: string } | null };

function toOrder(row: PersistedOrder & { fleet?: { name: string } | null }): Order {
  return {
    id: row.id,
    orderNo: row.platformOrderNumber,
    serviceDate: row.serviceDate,
    pickupTime: row.pickupDateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }),
    city: row.city as Order["city"],
    fleetName: row.fleet?.name ?? "待选择",
    passengerName: row.passengerName,
    passengerPhone: row.passengerPhone,
    route: `${row.pickupAddress} → ${row.dropoffAddress}`,
    vehicleType: row.platformVehicleType,
    status: row.status as Order["status"],
    exceptions: [],
    createdAt: row.createdAt.toISOString(),
  };
}

function toDriverDetails(row: DriverDetail): DriverDetails {
  // 旧数据也按当前规则展示，避免历史上保存的简称（如 All New V9）
  // 在回传时漏掉品牌与车型前缀。
  const rules = loadRules();
  return {
    orderId: row.orderId,
    rawReply: row.rawReply ?? "",
    confirmedDriverName: row.confirmedDriverName,
    rawDriverPhone: row.rawDriverPhone,
    normalizedDriverPhone: row.normalizedDriverPhone,
    confirmedVehicleModel: normalizeVehicleModel(row.confirmedVehicleModel, rules),
    licensePlate: normalizeLicensePlateForReturn(row.licensePlate),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
  };
}

function toIwayBatch(row: { id: string; serviceDate: string; ruleVersion: string; contentSnapshot: string; copiedAt: Date | null; confirmedAt: Date | null; orders: { orderId: string }[] }): IwayBatch {
  return { id: row.id, orderIds: row.orders.map((link) => link.orderId), serviceDate: row.serviceDate, text: row.contentSnapshot, ruleVersion: row.ruleVersion, copiedAt: row.copiedAt?.toISOString() ?? null, confirmedAt: row.confirmedAt?.toISOString() ?? null };
}

function fieldLabels(fields: string[]) {
  const labels: Record<string, string> = { platform_order_number: "订单号", pickup_datetime: "接车时间", confirmed_vehicle_model: "确认车型", confirmed_driver_name: "司机姓名", normalized_driver_phone: "司机电话", license_plate: "车牌号" };
  return fields.map((field) => labels[field] ?? field);
}

function iwayContext(order: Order, driver: DriverDetails | null | undefined) {
  return {
    platform_order_number: order.orderNo,
    pickup_datetime: `${order.serviceDate} ${order.pickupTime}`,
    confirmed_vehicle_model: driver?.confirmedVehicleModel,
    confirmed_driver_name: driver?.confirmedDriverName,
    normalized_driver_phone: driver?.normalizedDriverPhone,
    license_plate: driver?.licensePlate,
  };
}

async function findOrderWithDriver(orderId: string): Promise<OrderWithDriver | null> {
  return db.order.findUnique({ where: { id: orderId }, include: { driverDetail: true, fleet: true } });
}

async function findOrdersWithDrivers(orderIds: string[]): Promise<OrderWithDriver[]> {
  return db.order.findMany({
    where: { id: { in: orderIds } },
    include: { driverDetail: true, fleet: true },
    orderBy: { pickupDateTime: "asc" },
  });
}

export async function listDriverWork() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.order.findMany({
    where: { serviceDate: { gte: today }, status: { in: ["DISPATCHED", "DRIVER_CONFIRMED", "RETURNED", "COMPLETED"] } },
    include: { driverDetail: true, fleet: true },
    orderBy: { pickupDateTime: "asc" },
  });
  return rows.map((row) => ({ order: toOrder(row), driver: row.driverDetail ? toDriverDetails(row.driverDetail) : null }));
}

export async function getDriverDetails(orderId: string) {
  const row = await db.driverDetail.findUnique({ where: { orderId } });
  return row ? toDriverDetails(row) : null;
}

export async function saveDriverDetails(orderId: string, input: DriverDetailsInput) {
  const persisted = await findOrderWithDriver(orderId);
  if (!persisted) throw new Error("ORDER_NOT_FOUND");
  const order = toOrder(persisted);
  const rules = loadRules();
  const normalizedDriverPhone = normalizeThailandPhone(input.rawDriverPhone, rules);
  const record: DriverDetails = {
    orderId,
    rawReply: input.rawReply?.trim() ?? "",
    confirmedDriverName: input.confirmedDriverName?.trim() || null,
    rawDriverPhone: input.rawDriverPhone?.trim() || null,
    normalizedDriverPhone,
    confirmedVehicleModel: normalizeVehicleModel(input.confirmedVehicleModel, rules),
    licensePlate: normalizeLicensePlateForReturn(input.licensePlate),
    confirmedAt: null,
  };
  const check = validateRequiredFields(iwayContext(order, record), "before_iway_return", rules);
  const confirmedAt = check.valid ? new Date() : null;
  const driver = await db.$transaction(async (tx) => {
    const saved = await tx.driverDetail.upsert({
      where: { orderId },
      update: { rawReply: record.rawReply, confirmedDriverName: record.confirmedDriverName, rawDriverPhone: record.rawDriverPhone, normalizedDriverPhone: record.normalizedDriverPhone, confirmedVehicleModel: record.confirmedVehicleModel, licensePlate: record.licensePlate, confirmedAt },
      create: { orderId, rawReply: record.rawReply, confirmedDriverName: record.confirmedDriverName, rawDriverPhone: record.rawDriverPhone, normalizedDriverPhone: record.normalizedDriverPhone, confirmedVehicleModel: record.confirmedVehicleModel, licensePlate: record.licensePlate, confirmedAt },
    });
    if (check.valid && persisted.status !== "DRIVER_CONFIRMED") {
      await tx.order.update({ where: { id: orderId }, data: { status: "DRIVER_CONFIRMED" } });
      await tx.activityLog.create({ data: { orderId, action: "确认司机资料", actor: "运营人员", metadata: `规则版本：${rules.rules_version}` } });
    }
    return saved;
  });
  return { driver: toDriverDetails(driver), valid: check.valid, missingFields: fieldLabels(check.missingFields), ruleVersion: rules.rules_version };
}

export type IwayPreview = { valid: boolean; errors: string[]; text?: string; orderCount: number; serviceDate?: string; ruleVersion: string };

export async function createIwayPreview(orderIds: string[]): Promise<IwayPreview> {
  const rules = loadRules();
  const selected = await findOrdersWithDrivers(orderIds);
  const errors: string[] = [];
  if (!selected.length) errors.push("请至少选择一张订单。");
  if (selected.length !== orderIds.length) errors.push("有订单不存在。");
  const dates = new Set(selected.map((order) => order.serviceDate));
  if (dates.size > 1) errors.push("i’way 回传只能合并同一服务日的订单。");
  selected.forEach((row) => {
    const order = toOrder(row);
    const driver = row.driverDetail ? toDriverDetails(row.driverDetail) : null;
    if (order.status !== "DRIVER_CONFIRMED" && order.status !== "RETURNED") errors.push(`${order.orderNo} 尚未确认完整司机资料。`);
    const check = validateRequiredFields(iwayContext(order, driver), "before_iway_return", rules);
    if (!check.valid) errors.push(`${order.orderNo} 缺少：${fieldLabels(check.missingFields).join("、")}`);
  });
  if (errors.length) return { valid: false, errors, orderCount: selected.length, ruleVersion: rules.rules_version };
  const serviceDate = selected[0].serviceDate;
  const bodies = selected.map((row) => renderTemplate(rules.templates.iway_return.body, iwayContext(toOrder(row), row.driverDetail ? toDriverDetails(row.driverDetail) : null)));
  const text = [renderTemplate(rules.templates.iway_return.header, { service_date_label_en: formatServiceDateLabel(serviceDate, "en") }), ...bodies, rules.templates.iway_return.footer].join("\n\n");
  return { valid: true, errors: [], text, orderCount: selected.length, serviceDate, ruleVersion: rules.rules_version };
}

export async function saveIwayCopy(orderIds: string[]) {
  const preview = await createIwayPreview(orderIds);
  if (!preview.valid || !preview.text || !preview.serviceDate) return preview;
  const batch = await db.$transaction(async (tx) => {
    const created = await tx.iwayReturnBatch.create({
      data: { serviceDate: preview.serviceDate!, ruleVersion: preview.ruleVersion, contentSnapshot: preview.text!, copiedAt: new Date(), orders: { create: orderIds.map((orderId) => ({ orderId })) } },
      include: { orders: true },
    });
    await tx.activityLog.createMany({ data: orderIds.map((orderId) => ({ orderId, action: "复制 i’way 回传内容", actor: "运营人员", metadata: `回传批次：${created.id}` })) });
    return created;
  });
  return { ...preview, batchId: batch.id };
}

export async function confirmIwayReturn(batchId: string) {
  const batch = await db.iwayReturnBatch.findUnique({ where: { id: batchId }, include: { orders: true } });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  const orderIds = batch.orders.map((link) => link.orderId);
  const completed = await db.$transaction(async (tx) => {
    const confirmedAt = new Date();
    const updated = await tx.iwayReturnBatch.update({ where: { id: batchId }, data: { confirmedAt }, include: { orders: true } });
    if (orderIds.length) {
      await tx.order.updateMany({ where: { id: { in: orderIds } }, data: { status: "COMPLETED" } });
      await tx.activityLog.createMany({ data: orderIds.map((orderId) => ({ orderId, action: "确认 i’way 回传完成", actor: "运营人员", metadata: `回传批次：${batchId}` })) });
    }
    return updated;
  });
  return toIwayBatch(completed);
}
