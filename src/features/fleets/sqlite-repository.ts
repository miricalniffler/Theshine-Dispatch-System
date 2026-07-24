import { db } from "@/lib/db";
import type { Fleet, FleetInput } from "./types";

function decode(row: { id: string; name: string; city: string; isActive: boolean; note: string | null; updatedAt: Date }): Fleet { const extra = row.note ? JSON.parse(row.note) : {}; return { id: row.id, name: row.name, city: row.city as Fleet["city"], chatNote: extra.chatNote ?? "", vehicleTypes: extra.vehicleTypes ?? [], note: extra.note ?? "", enabled: row.isActive, updatedAt: row.updatedAt.toISOString() }; }
export async function listSqliteFleets(city?: string) { return (await db.fleet.findMany({ where: city ? { city } : {}, orderBy: { updatedAt: "desc" } })).map(decode); }
export async function createSqliteFleet(input: FleetInput) { return decode(await db.fleet.create({ data: { name: input.name, city: input.city, isActive: input.enabled, note: JSON.stringify({ chatNote: input.chatNote, vehicleTypes: input.vehicleTypes, note: input.note }) } })); }
export async function getSqliteFleet(id: string) { const row = await db.fleet.findUnique({ where: { id } }); return row ? decode(row) : undefined; }
export async function updateSqliteFleet(id: string, input: FleetInput) { try { return decode(await db.fleet.update({ where: { id }, data: { name: input.name, city: input.city, isActive: input.enabled, note: JSON.stringify({ chatNote: input.chatNote, vehicleTypes: input.vehicleTypes, note: input.note }) } })); } catch { return undefined; } }
export async function deleteSqliteFleet(id: string) {
  const fleet = await db.fleet.findUnique({ where: { id } });
  if (!fleet) return undefined;
  await db.$transaction(async (tx) => {
    const linkedOrders = await tx.order.findMany({ where: { fleetId: id }, select: { id: true } });
    await tx.order.updateMany({ where: { fleetId: id }, data: { fleetId: null } });
    if (linkedOrders.length) await tx.activityLog.createMany({ data: linkedOrders.map((order) => ({ orderId: order.id, action: "关联车队已删除，待重新选择车队", actor: "运营人员", metadata: JSON.stringify({ fleetId: id, fleetName: fleet.name }) })) });
    await tx.fleet.delete({ where: { id } });
  });
  return decode(fleet);
}
