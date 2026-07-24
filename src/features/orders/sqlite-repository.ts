import { db } from "@/lib/db";
import type { Order, OrderFilters } from "./types";
import { toBangkokDate, type OrderEditInput } from "./order-edit-validation";
import { canonicalFleetForCity } from "@/features/fleets/canonical-fleets";

export async function findPersistedOrder(id: string) {
  return db.order.findUnique({ where: { id }, include: { activityLogs: { orderBy: { createdAt: "asc" } } } });
}

export async function recordOrderActivity(orderId: string, action: string, metadata?: string) {
  return db.activityLog.create({ data: { orderId, action, actor: "运营人员", metadata } });
}

export async function updatePersistedOrder(id: string, input: OrderEditInput) {
  const existing = await db.order.findUnique({ where: { id } });
  if (!existing) return { kind: "not-found" as const };
  const pickupDateTime = toBangkokDate(input.pickupDateTime);
  const routedFleet = await canonicalFleetForCity(db, input.city);
  const values = { platformOrderNumber: input.platformOrderNumber, city: input.city, fleetId: routedFleet.id, pickupDateTime: pickupDateTime.toISOString(), pickupAddress: input.pickupAddress, dropoffAddress: input.dropoffAddress, passengerName: input.passengerName, passengerPhone: input.passengerPhone, flightNumber: input.flightNumber, platformVehicleType: input.platformVehicleType, seatCount: input.seatCount, adults: input.adults, children: input.children, luggage: input.luggage, childSeatLine: input.childSeatLine, meetGreetLine: input.meetGreetLine, otherNotes: input.otherNotes };
  const updatedFields = Object.entries(values).filter(([field, value]) => { const old = existing[field as keyof typeof existing]; return old instanceof Date ? old.toISOString() !== value : old !== value; }).map(([field]) => field);
  const order = await db.$transaction(async (tx) => {
    const fleet = await canonicalFleetForCity(tx, input.city);
    const { fleetId: _ignoredFleetId, ...editableFields } = input;
    const result = await tx.order.update({ where: { id }, data: { ...editableFields, fleetId: fleet.id, serviceDate: input.pickupDateTime.slice(0, 10), pickupDateTime } });
    if (updatedFields.length) await tx.activityLog.create({ data: { orderId: id, action: "订单信息已编辑", actor: "运营人员", metadata: JSON.stringify({ fields: updatedFields }) } });
    return result;
  });
  return { kind: "updated" as const, order, updatedFields };
}

export async function saveOrderToSqlite(order: Order) {
  const [pickupAddress, dropoffAddress] = order.route.split(" → ");
  const fleet = await canonicalFleetForCity(db, order.city);
  return db.order.upsert({ where: { platformOrderNumber: order.orderNo }, update: { status: order.status, fleetId: fleet.id }, create: { id: order.id, platformOrderNumber: order.orderNo, city: order.city, fleetId: fleet.id, serviceDate: order.serviceDate, pickupDateTime: new Date(`${order.serviceDate}T${order.pickupTime}:00+07:00`), pickupAddress: pickupAddress || "待核对", dropoffAddress: dropoffAddress || "待核对", passengerName: order.passengerName, passengerPhone: order.passengerPhone, platformVehicleType: order.vehicleType, status: order.status } });
}

function bangkokToday() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function matchesFilters(order: Order, filters: OrderFilters) {
  const today = bangkokToday();
  const offsetDate = (days: number) => {
    const value = new Date(`${today}T12:00:00+07:00`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  if (filters.dateMode === "window" && (order.serviceDate < today || order.serviceDate > offsetDate(7))) return false;
  if (filters.dateMode === "today" && order.serviceDate !== today) return false;
  if (filters.dateMode === "tomorrow" && order.serviceDate !== offsetDate(1)) return false;
  if (filters.dateMode === "future" && order.serviceDate <= today) return false;
  if (filters.dateMode === "month" && order.serviceDate.slice(0, 7) !== today.slice(0, 7)) return false;
  if (filters.dateMode === "range") {
    if (filters.startDate && order.serviceDate < filters.startDate) return false;
    if (filters.endDate && order.serviceDate > filters.endDate) return false;
  }
  if (filters.city && order.city !== filters.city) return false;
  if (filters.fleet && order.fleetName !== filters.fleet) return false;
  if (filters.status && order.status !== filters.status) return false;
  if (filters.exception && !order.exceptions.includes(filters.exception as Order["exceptions"][number])) return false;
  if (filters.keyword) {
    const keyword = filters.keyword.trim().toLowerCase();
    const searchable = [order.orderNo, order.passengerName, order.passengerPhone, order.route].join(" ").toLowerCase();
    if (!searchable.includes(keyword)) return false;
  }
  return true;
}

export async function listSqliteOrders(filters: OrderFilters = {}) {
  const rows = await db.order.findMany({ include: { fleet: true }, orderBy: { pickupDateTime: "asc" } });
  return rows
    .map((row) => ({ id: row.id, orderNo: row.platformOrderNumber, serviceDate: row.serviceDate, pickupTime: row.pickupDateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }), city: row.city as Order["city"], fleetName: row.fleet?.name ?? "待选择", passengerName: row.passengerName, passengerPhone: row.passengerPhone, route: `${row.pickupAddress} → ${row.dropoffAddress}`, vehicleType: row.platformVehicleType, status: row.status as Order["status"], exceptions: [], createdAt: row.createdAt.toISOString() }))
    .filter((order) => matchesFilters(order, filters));
}
