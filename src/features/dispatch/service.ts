import { loadRules } from "@/lib/rules/load-rules";
import { renderDispatchBatchFooter, renderTemplate, validateRequiredFields } from "@/lib/rules/engine";
import { demoOrderRepository } from "@/features/orders/demo-repository";
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

type StoredDispatchBatch = {
  id: string;
  orderIds: string[];
  text: string;
  ruleVersion: string;
  copiedAt: string;
  confirmedAt: string | null;
};

/**
 * The dashboard still exposes the lightweight `DispatchOrder` shape.  Before a
 * dispatch is saved we make sure its related Fleet and Order rows exist in
 * SQLite, so a saved batch always has an immutable, relational audit trail.
 */
async function ensureOrdersPersisted(orders: DispatchOrder[]) {
  return db.$transaction(async (tx) => {
    const fleetIds = new Map<string, string>();

    for (const order of orders) {
      const fleetKey = `${order.city}\u0000${order.fleetName}`;
      let fleetId = fleetIds.get(fleetKey);
      if (!fleetId) {
        const fleet = await tx.fleet.upsert({
          where: { name_city: { name: order.fleetName, city: order.city } },
          update: {},
          create: { name: order.fleetName, city: order.city },
        });
        fleetId = fleet.id;
        fleetIds.set(fleetKey, fleetId);
      }

      const [pickupAddress = "待核对", dropoffAddress = "待核对"] = order.city === "曼谷"
        ? ["Suvarnabhumi Airport (BKK), Gate 3", "Sukhumvit 24, Bangkok"]
        : ["Samui Airport (USM), Arrival Hall", "Chaweng Beach Road, Koh Samui"];

      await tx.order.upsert({
        where: { id: order.id },
        update: {
          city: order.city,
          fleetId,
          serviceDate: order.serviceDate,
          pickupDateTime: new Date(`${order.serviceDate}T${order.pickupTime}:00+07:00`),
          passengerName: order.passengerName,
          passengerPhone: order.passengerPhone,
          platformVehicleType: order.vehicleType,
          status: order.status,
        },
        create: {
          id: order.id,
          platformOrderNumber: order.orderNo,
          city: order.city,
          fleetId,
          serviceDate: order.serviceDate,
          pickupDateTime: new Date(`${order.serviceDate}T${order.pickupTime}:00+07:00`),
          pickupAddress,
          dropoffAddress,
          passengerName: order.passengerName,
          passengerPhone: order.passengerPhone,
          platformVehicleType: order.vehicleType,
          status: order.status,
        },
      });
    }
  });
}

async function selectedDispatchOrders(orderIds: string[]) {
  const all = await demoOrderRepository.list({ dateMode: "future" });
  return all.filter((order) => orderIds.includes(order.id)) as DispatchOrder[];
}

export async function createDispatchPreview(orderIds: string[]): Promise<DispatchPreview> {
  const rules = loadRules();
  const selected = await selectedDispatchOrders(orderIds);
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
  const selected = await selectedDispatchOrders(orderIds);
  await ensureOrdersPersisted(selected);

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
    // Keep the still-used in-memory workflow in sync while the other modules
    // are being migrated. SQLite remains the durable source of truth.
    await Promise.all(orderIds.map((id) => demoOrderRepository.updateStatus(id, "DISPATCHED")));
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
