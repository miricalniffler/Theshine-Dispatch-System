import { db } from "@/lib/db";
import type { Order } from "./types";
import { toBangkokDate, type OrderEditInput } from "./order-edit-validation";

export async function findPersistedOrder(id: string) {
  return db.order.findUnique({ where: { id }, include: { activityLogs: { orderBy: { createdAt: "asc" } } } });
}

export async function recordOrderActivity(orderId: string, action: string, metadata?: string) {
  return db.activityLog.create({ data: { orderId, action, actor: "运营人员", metadata } });
}

export async function updatePersistedOrder(id: string, input: OrderEditInput) {
  const existing = await db.order.findUnique({ where: { id } });
  if (!existing) return { kind: "not-found" as const };
  if (input.fleetId) {
    const fleet = await db.fleet.findUnique({ where: { id: input.fleetId } });
    if (!fleet || fleet.city !== input.city) return { kind: "invalid-fleet" as const };
  }
  const pickupDateTime = toBangkokDate(input.pickupDateTime);
  const values = { platformOrderNumber: input.platformOrderNumber, city: input.city, fleetId: input.fleetId, pickupDateTime: pickupDateTime.toISOString(), pickupAddress: input.pickupAddress, dropoffAddress: input.dropoffAddress, passengerName: input.passengerName, passengerPhone: input.passengerPhone, flightNumber: input.flightNumber, platformVehicleType: input.platformVehicleType, seatCount: input.seatCount, adults: input.adults, children: input.children, luggage: input.luggage, childSeatLine: input.childSeatLine, meetGreetLine: input.meetGreetLine, otherNotes: input.otherNotes };
  const updatedFields = Object.entries(values).filter(([field, value]) => { const old = existing[field as keyof typeof existing]; return old instanceof Date ? old.toISOString() !== value : old !== value; }).map(([field]) => field);
  const order = await db.$transaction(async (tx) => {
    const result = await tx.order.update({ where: { id }, data: { ...input, serviceDate: input.pickupDateTime.slice(0, 10), pickupDateTime } });
    if (updatedFields.length) await tx.activityLog.create({ data: { orderId: id, action: "订单信息已编辑", actor: "运营人员", metadata: JSON.stringify({ fields: updatedFields }) } });
    return result;
  });
  return { kind: "updated" as const, order, updatedFields };
}

export async function saveOrderToSqlite(order: Order) {
  const [pickupAddress, dropoffAddress] = order.route.split(" → ");
  return db.order.upsert({ where: { platformOrderNumber: order.orderNo }, update: { status: order.status, fleetId: null }, create: { id: order.id, platformOrderNumber: order.orderNo, city: order.city, serviceDate: order.serviceDate, pickupDateTime: new Date(`${order.serviceDate}T${order.pickupTime}:00+07:00`), pickupAddress: pickupAddress || "待核对", dropoffAddress: dropoffAddress || "待核对", passengerName: order.passengerName, passengerPhone: order.passengerPhone, platformVehicleType: order.vehicleType, status: order.status } });
}

export async function listSqliteOrders() {
  const rows = await db.order.findMany({ orderBy: { pickupDateTime: "asc" } });
  return rows.map((row) => ({ id: row.id, orderNo: row.platformOrderNumber, serviceDate: row.serviceDate, pickupTime: row.pickupDateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }), city: row.city as Order["city"], fleetName: "待选择", passengerName: row.passengerName, passengerPhone: row.passengerPhone, route: `${row.pickupAddress} → ${row.dropoffAddress}`, vehicleType: row.platformVehicleType, status: row.status as Order["status"], exceptions: [], createdAt: row.createdAt.toISOString() }));
}
