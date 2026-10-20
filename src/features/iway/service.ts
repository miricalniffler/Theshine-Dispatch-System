import { db } from "@/lib/db";
import type { DriverDetail, Order as PersistedOrder } from "@prisma/client";
import type { Order } from "@/features/orders/types";
import { formatServiceDateLabel, normalizeLicensePlateForReturn, normalizeThailandPhone, normalizeVehicleModel, renderTemplate, validateRequiredFields } from "@/lib/rules/engine";
import { loadRules } from "@/lib/rules/load-rules";
import { prepareDriverNotificationForOrder } from "@/features/customer-notifications/service";
import { archiveDriverVehicle, isTemporaryName } from "@/features/archives/service";

export type DriverDetails = {
  orderId: string;
  rawReply: string;
  confirmedDriverName: string | null;
  rawDriverPhone: string | null;
  normalizedDriverPhone: string | null;
  confirmedVehicleModel: string | null;
  confirmedVehicleCategory: string | null;
  licensePlate: string | null;
  confirmedAt: string | null;
  driverProfileId: string | null;
  vehicleProfileId: string | null;
  driverNameSource: string;
  iwayDriverName: string | null;
};

export type DriverDetailsInput = Pick<DriverDetails, "rawReply" | "confirmedDriverName" | "rawDriverPhone" | "confirmedVehicleModel" | "licensePlate"> & { confirmedVehicleCategory?: string | null; rawLicensePlate?: string | null };

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
    confirmedVehicleCategory: row.confirmedVehicleCategory,
    licensePlate: normalizeLicensePlateForReturn(row.licensePlate),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    driverProfileId: row.driverProfileId,
    vehicleProfileId: row.vehicleProfileId,
    driverNameSource: row.driverNameSource,
    iwayDriverName: row.iwayDriverName,
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
    confirmed_driver_name: driver?.iwayDriverName || driver?.confirmedDriverName,
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
  if (persisted.status === "CANCELLED") throw new Error("ORDER_CANCELLED");
  const order = toOrder(persisted);
  const rules = loadRules();
  const normalizedDriverPhone = normalizeThailandPhone(input.rawDriverPhone, rules);
  const record: DriverDetails = {
    orderId,
    rawReply: input.rawReply?.trim() ?? "",
    confirmedDriverName: input.confirmedDriverName?.trim() || "无名氏",
    rawDriverPhone: input.rawDriverPhone?.trim() || null,
    normalizedDriverPhone,
    confirmedVehicleModel: normalizeVehicleModel(input.confirmedVehicleModel, rules),
    confirmedVehicleCategory: input.confirmedVehicleCategory?.trim() || null,
    licensePlate: normalizeLicensePlateForReturn(input.licensePlate),
    confirmedAt: null,
    driverProfileId: persisted.driverDetail?.driverProfileId ?? null,
    vehicleProfileId: persisted.driverDetail?.vehicleProfileId ?? null,
    driverNameSource: input.confirmedDriverName?.trim() ? "MANUAL" : "TEMPORARY",
    iwayDriverName: input.confirmedDriverName?.trim() || null,
  };
  const check = validateRequiredFields(iwayContext(order, record), "before_iway_return", rules);
  const confirmedAt = check.valid ? new Date() : null;
  const driver = await db.$transaction(async (tx) => {
    // The status may have changed after the initial read (for example an
    // operator cancelled the order in another tab).  Check again in the same
    // transaction before writing driver data.
    const currentOrder = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!currentOrder) throw new Error("ORDER_NOT_FOUND");
    if (currentOrder.status === "CANCELLED") throw new Error("ORDER_CANCELLED");
    const saved = await tx.driverDetail.upsert({
      where: { orderId },
      update: { rawReply: record.rawReply, confirmedDriverName: record.confirmedDriverName, rawDriverPhone: record.rawDriverPhone, normalizedDriverPhone: record.normalizedDriverPhone, confirmedVehicleModel: record.confirmedVehicleModel, confirmedVehicleCategory: record.confirmedVehicleCategory, licensePlate: record.licensePlate, confirmedAt },
      create: { orderId, rawReply: record.rawReply, confirmedDriverName: record.confirmedDriverName, rawDriverPhone: record.rawDriverPhone, normalizedDriverPhone: record.normalizedDriverPhone, confirmedVehicleModel: record.confirmedVehicleModel, confirmedVehicleCategory: record.confirmedVehicleCategory, licensePlate: record.licensePlate, confirmedAt },
    });
    const archive = await archiveDriverVehicle(tx, {
      orderId,
      orderStatus: currentOrder.status,
      existingDriverProfileId: saved.driverProfileId,
      existingVehicleProfileId: saved.vehicleProfileId,
      driverName: input.confirmedDriverName,
      driverNameSource: input.confirmedDriverName?.trim() ? "MANUAL" : "TEMPORARY",
      rawPhone: input.rawDriverPhone,
      vehicleModel: record.confirmedVehicleModel,
      vehicleCategory: record.confirmedVehicleCategory,
      // The return format can normalize a plate, but the archive must retain
      // the original Thai text for future matching and for operators to audit.
      rawPlate: input.rawLicensePlate ?? input.licensePlate,
    });
    const archived = await tx.driverDetail.update({
      where: { id: saved.id },
      data: { driverProfileId: archive.driverProfileId, vehicleProfileId: archive.vehicleProfileId, driverNameSource: archive.driverNameSource, iwayDriverName: archive.iwayDriverName },
    });
    // Editing driver/vehicle details after a return is a correction, not a
    // rewind of the order lifecycle.  In particular, moving a COMPLETED
    // order back to DRIVER_CONFIRMED made the original completion disappear
    // and could accidentally put it back into the normal bulk-return queue.
    if (check.valid && (currentOrder.status === "DISPATCHED" || currentOrder.status === "READY_TO_DISPATCH")) {
      await tx.order.update({ where: { id: orderId }, data: { status: "DRIVER_CONFIRMED" } });
      await tx.activityLog.create({ data: { orderId, action: "确认司机资料", actor: "运营人员", metadata: `规则版本：${rules.rules_version}` } });
    }
    return archived;
  });
  return { driver: toDriverDetails(driver), valid: check.valid, missingFields: fieldLabels(check.missingFields), ruleVersion: rules.rules_version };
}

export type IwayPreview = { valid: boolean; errors: string[]; text?: string; orderCount: number; serviceDate?: string; ruleVersion: string; temporaryDriverNames?: { orderId: string; orderNo: string; name: string }[] };

/** A copied return batch is a draft. Any change to the rendered text makes it stale. */
export function isIwayPreviewCurrent(snapshot: string, current: Pick<IwayPreview, "valid" | "text">) {
  return current.valid && Boolean(current.text) && current.text === snapshot;
}

function buildIwayPreview(orderIds: string[], selected: OrderWithDriver[], rules = loadRules()): IwayPreview {
  const errors: string[] = [];
  if (!selected.length) errors.push("请至少选择一张订单。");
  if (selected.length !== orderIds.length) errors.push("有订单不存在。");
  const dates = new Set(selected.map((order) => order.serviceDate));
  if (dates.size > 1) errors.push("i’way 回传只能合并同一服务日的订单。");
  selected.forEach((row) => {
    const order = toOrder(row);
    const driver = row.driverDetail ? toDriverDetails(row.driverDetail) : null;
    // COMPLETED orders may need a corrected, manually sent i'way reply after
    // a legitimate driver or vehicle correction. Cancellation remains blocked
    // by the same guard because it is not an allowed status here.
    if (order.status !== "DRIVER_CONFIRMED" && order.status !== "RETURNED" && order.status !== "COMPLETED") errors.push(`${order.orderNo} 尚未确认完整司机资料。`);
    const check = validateRequiredFields(iwayContext(order, driver), "before_iway_return", rules);
    if (!check.valid) errors.push(`${order.orderNo} 缺少：${fieldLabels(check.missingFields).join("、")}`);
  });
  if (errors.length) return { valid: false, errors, orderCount: selected.length, ruleVersion: rules.rules_version };
  const serviceDate = selected[0].serviceDate;
  const bodies = selected.map((row) => renderTemplate(rules.templates.iway_return.body, iwayContext(toOrder(row), row.driverDetail ? toDriverDetails(row.driverDetail) : null)));
  const text = [renderTemplate(rules.templates.iway_return.header, { service_date_label_en: formatServiceDateLabel(serviceDate, "en") }), ...bodies, rules.templates.iway_return.footer].join("\n\n");
  const temporaryDriverNames = selected.flatMap((row) => row.driverDetail && isTemporaryName(row.driverDetail.driverNameSource) && row.driverDetail.iwayDriverName ? [{ orderId: row.id, orderNo: row.platformOrderNumber, name: row.driverDetail.iwayDriverName }] : []);
  return { valid: true, errors: [], text, orderCount: selected.length, serviceDate, ruleVersion: rules.rules_version, temporaryDriverNames };
}

export async function createIwayPreview(orderIds: string[]): Promise<IwayPreview> {
  return buildIwayPreview(orderIds, await findOrdersWithDrivers(orderIds));
}

export async function saveIwayCopy(orderIds: string[]) {
  const preview = await createIwayPreview(orderIds);
  if (!preview.valid || !preview.text || !preview.serviceDate) return preview;
  const batch = await db.$transaction(async (tx) => {
    const created = await tx.iwayReturnBatch.create({
      data: { serviceDate: preview.serviceDate!, ruleVersion: preview.ruleVersion, contentSnapshot: preview.text!, copiedAt: new Date(), orders: { create: orderIds.map((orderId) => { const temporary = preview.temporaryDriverNames?.find((item) => item.orderId === orderId); return { orderId, driverNameSnapshot: temporary?.name ?? null, driverNameSourceSnapshot: temporary ? "TEMPORARY" : null }; }) } },
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
  // A saved preview is only a draft. Revalidate it at confirmation time so a
  // cancellation, edit, or missing driver detail cannot be returned later.
  const current = await createIwayPreview(orderIds);
  if (!current.valid) throw new Error(`IWAY_PREVIEW_STALE:${current.errors.join("；")}`);
  if (!isIwayPreviewCurrent(batch.contentSnapshot, current)) {
    throw new Error("IWAY_PREVIEW_STALE:订单或司机车辆资料已变更，请重新生成并复制回传内容。");
  }
  const completed = await db.$transaction(async (tx) => {
    // Re-read in the transaction.  A cancellation or a driver/vehicle edit
    // between the first validation and this write must not be overwritten by
    // the confirmation below.
    const rows = await tx.order.findMany({
      where: { id: { in: orderIds } },
      include: { driverDetail: true, fleet: true },
      orderBy: { pickupDateTime: "asc" },
    });
    const latest = buildIwayPreview(orderIds, rows);
    if (!isIwayPreviewCurrent(batch.contentSnapshot, latest)) {
      throw new Error("IWAY_PREVIEW_STALE:订单在确认期间已变化或已取消，请重新生成并复制回传内容。");
    }
    const confirmedAt = new Date();
    const updated = await tx.iwayReturnBatch.update({ where: { id: batchId }, data: { confirmedAt }, include: { orders: true } });
    if (orderIds.length) {
      await tx.order.updateMany({ where: { id: { in: orderIds } }, data: { status: "COMPLETED" } });
      await tx.activityLog.createMany({ data: orderIds.map((orderId) => ({ orderId, action: "确认 i’way 回传完成", actor: "运营人员", metadata: `回传批次：${batchId}` })) });
    }
    return updated;
  });
  // The i’way confirmation is the business fact. Customer-notification
  // preparation runs afterwards and is intentionally best-effort: a future
  // transport failure must never undo a confirmed i’way return.
  await Promise.all(orderIds.map(async (orderId) => {
    try { await prepareDriverNotificationForOrder(orderId); }
    catch { await db.activityLog.create({ data: { orderId, action: "司机资料客人通知准备失败", actor: "系统", metadata: "i’way 回传已保留；请在订单详情重新生成。" } }); }
  }));
  return toIwayBatch(completed);
}
