import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Order, OrderFilters } from "./types";
import { toBangkokDate, type OrderEditInput } from "./order-edit-validation";
import { canonicalFleetForCity } from "@/features/fleets/canonical-fleets";

export async function findPersistedOrder(id: string) {
  return db.order.findUnique({ where: { id }, include: { driverDetail: true, activityLogs: { orderBy: { createdAt: "asc" } } } });
}

export async function recordOrderActivity(orderId: string, action: string, metadata?: string) {
  return db.activityLog.create({ data: { orderId, action, actor: "运营人员", metadata } });
}

export async function updatePersistedOrder(id: string, input: OrderEditInput) {
  const existing = await db.order.findUnique({ where: { id } });
  if (!existing) return { kind: "not-found" as const };
  if (existing.status === "CANCELLED") return { kind: "cancelled" as const };
  const pickupDateTime = toBangkokDate(input.pickupDateTime);
  const routedFleet = await canonicalFleetForCity(db, input.city);
  const values = { platformOrderNumber: input.platformOrderNumber, city: input.city, fleetId: routedFleet.id, pickupDateTime: pickupDateTime.toISOString(), pickupAddress: input.pickupAddress, dropoffAddress: input.dropoffAddress, passengerName: input.passengerName, passengerPhone: input.passengerPhone, flightNumber: input.flightNumber, platformVehicleType: input.platformVehicleType, seatCount: input.seatCount, adults: input.adults, children: input.children, luggage: input.luggage, childSeatLine: input.childSeatLine, meetGreetLine: input.meetGreetLine, otherNotes: input.otherNotes };
  const updatedFields = Object.entries(values).filter(([field, value]) => { const old = existing[field as keyof typeof existing]; return old instanceof Date ? old.toISOString() !== value : old !== value; }).map(([field]) => field);
  const order = await db.$transaction(async (tx) => {
    const fleet = await canonicalFleetForCity(tx, input.city);
    const { fleetId: _ignoredFleetId, ...editableFields } = input;
    const result = await tx.order.update({ where: { id }, data: { ...editableFields, fleetId: fleet.id, serviceDate: input.pickupDateTime.slice(0, 10), pickupDateTime } });
    if (updatedFields.length) await tx.activityLog.create({ data: { orderId: id, action: "订单信息已编辑", actor: "运营人员", metadata: JSON.stringify({ changes: Object.fromEntries(updatedFields.map((field) => [field, { from: existing[field as keyof typeof existing] instanceof Date ? (existing[field as keyof typeof existing] as Date).toISOString() : existing[field as keyof typeof existing], to: values[field as keyof typeof values] }])) }) } });
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

function bangkokDateRange(filters: OrderFilters) {
  const today = bangkokToday();
  const offsetDate = (days: number) => {
    const value = new Date(`${today}T12:00:00+07:00`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  if (filters.dateMode === "window") return { gte: today, lte: offsetDate(7) };
  if (filters.dateMode === "today") return { equals: today };
  if (filters.dateMode === "tomorrow") return { equals: offsetDate(1) };
  if (filters.dateMode === "future") return { gt: today };
  if (filters.dateMode === "month") return { startsWith: today.slice(0, 7) };
  if (filters.dateMode === "range") return { ...(filters.startDate ? { gte: filters.startDate } : {}), ...(filters.endDate ? { lte: filters.endDate } : {}) };
  return undefined;
}

export async function listSqliteOrders(filters: OrderFilters = {}) {
  const keyword = filters.keyword?.trim();
  const dateRange = bangkokDateRange(filters);
  const where: Prisma.OrderWhereInput = {
    ...(dateRange ? { serviceDate: dateRange } : {}),
    ...(filters.city ? { city: filters.city } : {}),
    ...(filters.fleet ? { fleet: { name: filters.fleet } } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.exception ? { customerCommunicationExceptions: { some: { status: "OPEN", exceptionType: filters.exception } } } : {}),
    ...(keyword ? {
      OR: [
        { platformOrderNumber: { contains: keyword, mode: "insensitive" } },
        { passengerName: { contains: keyword, mode: "insensitive" } },
        { passengerPhone: { contains: keyword, mode: "insensitive" } },
        { pickupAddress: { contains: keyword, mode: "insensitive" } },
        { dropoffAddress: { contains: keyword, mode: "insensitive" } },
      ],
    } : {}),
  };
  // The dashboard used to load every historical order and filter it in the
  // browser.  Let PostgreSQL apply the selected conditions before data leaves
  // the server, so the page remains quick as order history grows.
  const rows = await db.order.findMany({ where, include: { fleet: true, driverDetail: true, customerCommunicationExceptions: { where: { status: "OPEN" }, select: { exceptionType: true } } }, orderBy: { pickupDateTime: "asc" } });
  return rows
    .map((row) => ({ id: row.id, orderNo: row.platformOrderNumber, serviceDate: row.serviceDate, pickupTime: row.pickupDateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }), city: row.city as Order["city"], fleetName: row.fleet?.name ?? "待选择", passengerName: row.passengerName, passengerPhone: row.passengerPhone, route: `${row.pickupAddress} → ${row.dropoffAddress}`, vehicleType: row.platformVehicleType, status: row.status as Order["status"], exceptions: row.customerCommunicationExceptions.map((item) => item.exceptionType), createdAt: row.createdAt.toISOString(), driverDetail: row.driverDetail ? { confirmedDriverName: row.driverDetail.confirmedDriverName, normalizedDriverPhone: row.driverDetail.normalizedDriverPhone, confirmedVehicleModel: row.driverDetail.confirmedVehicleModel, licensePlate: row.driverDetail.licensePlate } : null }));
}
