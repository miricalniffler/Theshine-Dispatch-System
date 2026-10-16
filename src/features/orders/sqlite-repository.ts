import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Order, OrderFilters } from "./types";
import { toBangkokDate, type OrderEditInput } from "./order-edit-validation";
import { canonicalFleetForCity } from "@/features/fleets/canonical-fleets";

export async function findPersistedOrder(id: string) {
  // Keep the critical order screen compatible while an additive, optional
  // DriverDetail migration is being rolled out.  Reading every column from
  // that table made the whole order detail API fail on a lagging test DB.
  return db.order.findUnique({
    where: { id },
    include: {
      driverDetail: {
        select: {
          confirmedDriverName: true,
          rawDriverPhone: true,
          normalizedDriverPhone: true,
          confirmedVehicleModel: true,
          licensePlate: true,
          rawReply: true,
          confirmedAt: true,
        },
      },
      activityLogs: { orderBy: { createdAt: "asc" } },
    },
  });
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
    // Do the state check as part of the write.  A cancellation that happens
    // after the initial read must never be followed by an edit write.
    const changed = await tx.order.updateMany({ where: { id, status: { not: "CANCELLED" } }, data: { ...editableFields, fleetId: fleet.id, serviceDate: input.pickupDateTime.slice(0, 10), pickupDateTime } });
    if (!changed.count) return null;
    const result = await tx.order.findUniqueOrThrow({ where: { id } });
    if (updatedFields.length) await tx.activityLog.create({ data: { orderId: id, action: "订单信息已编辑", actor: "运营人员", metadata: JSON.stringify({ changes: Object.fromEntries(updatedFields.map((field) => [field, { from: existing[field as keyof typeof existing] instanceof Date ? (existing[field as keyof typeof existing] as Date).toISOString() : existing[field as keyof typeof existing], to: values[field as keyof typeof values] }])) }) } });
    return result;
  });
  if (!order) return { kind: "cancelled" as const };
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
  if (filters.dateMode === "future") return { gte: today };
  if (filters.dateMode === "month") return { startsWith: today.slice(0, 7) };
  if (filters.dateMode === "range") return { ...(filters.startDate ? { gte: filters.startDate } : {}), ...(filters.endDate ? { lte: filters.endDate } : {}) };
  return undefined;
}

export async function listSqliteOrders(filters: OrderFilters = {}) {
  const keyword = filters.keyword?.trim();
  // Searching a known order number is a recovery path as well as a filter:
  // do not hide a historical order merely because the workbench is currently
  // showing upcoming dates. The normal unsearched dashboard remains bounded.
  const dateRange = keyword ? undefined : bangkokDateRange(filters);
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
  // Deliberately select only the long-established driver columns used by the
  // dashboard. A newly deployed optional DriverDetail column must not make
  // every legacy order invisible before its additive migration is applied.
  const rows = await db.order.findMany({ where, include: { fleet: true, driverDetail: { select: { confirmedDriverName: true, normalizedDriverPhone: true, confirmedVehicleModel: true, licensePlate: true } }, customerCommunicationExceptions: { where: { status: "OPEN" }, select: { exceptionType: true } }, activityLogs: { where: { action: { in: ["订单已取消", "飞书邮件同步：订单已取消"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { action: true, metadata: true, createdAt: true } } }, orderBy: { pickupDateTime: "asc" } });
  const notes = rows.length ? await db.activityLog.findMany({ where: { orderId: { in: rows.map((row) => row.id) }, action: "新增异常备注" }, orderBy: { createdAt: "desc" }, select: { orderId: true, metadata: true, createdAt: true } }) : [];
  const latestNotes = new Map<string, { note: string; at: Date }>();
  for (const item of notes) {
    if (!item.orderId || latestNotes.has(item.orderId)) continue;
    try { const data = JSON.parse(item.metadata ?? "{}"); if (typeof data.note === "string") latestNotes.set(item.orderId, { note: data.note, at: item.createdAt }); } catch { /* ignore legacy malformed audit metadata */ }
  }
  return rows
    .map((row) => {
      const cancellation = row.activityLogs[0];
      let cancelReason: string | null = null;
      if (cancellation?.metadata) try { const data = JSON.parse(cancellation.metadata); cancelReason = typeof data.reason === "string" ? data.reason : null; } catch { /* legacy plain text metadata */ }
      const latestNote = latestNotes.get(row.id);
      return { id: row.id, orderNo: row.platformOrderNumber, serviceDate: row.serviceDate, pickupTime: row.pickupDateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }), city: row.city as Order["city"], fleetName: row.fleet?.name ?? "待选择", passengerName: row.passengerName, passengerPhone: row.passengerPhone, route: `${row.pickupAddress} → ${row.dropoffAddress}`, vehicleType: row.platformVehicleType, status: row.status as Order["status"], cancelReason, cancelledAt: cancellation?.createdAt.toISOString() ?? null, restoreBlockedReason: cancellation?.action === "飞书邮件同步：订单已取消" ? "此订单由飞书同步取消，需先在外部平台核实恢复状态。" : null, latestExceptionNote: latestNote?.note ?? null, latestExceptionAt: latestNote?.at.toISOString() ?? null, exceptions: row.customerCommunicationExceptions.map((item) => item.exceptionType), createdAt: row.createdAt.toISOString(), driverDetail: row.driverDetail ? { confirmedDriverName: row.driverDetail.confirmedDriverName, normalizedDriverPhone: row.driverDetail.normalizedDriverPhone, confirmedVehicleModel: row.driverDetail.confirmedVehicleModel, licensePlate: row.driverDetail.licensePlate } : null };
    });
}
