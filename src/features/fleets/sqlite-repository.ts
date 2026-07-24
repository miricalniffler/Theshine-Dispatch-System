import { db } from "@/lib/db";
import type { Fleet, FleetInput } from "./types";

function decode(row: { id: string; name: string; city: string; isActive: boolean; note: string | null; updatedAt: Date }): Fleet { const extra = row.note ? JSON.parse(row.note) : {}; return { id: row.id, name: row.name, city: row.city as Fleet["city"], chatNote: extra.chatNote ?? "", vehicleTypes: extra.vehicleTypes ?? [], note: extra.note ?? "", enabled: row.isActive, updatedAt: row.updatedAt.toISOString() }; }
export async function listSqliteFleets(city?: string) { return (await db.fleet.findMany({ where: city ? { city } : {}, orderBy: { updatedAt: "desc" } })).map(decode); }
export async function createSqliteFleet(input: FleetInput) { return decode(await db.fleet.create({ data: { name: input.name, city: input.city, isActive: input.enabled, note: JSON.stringify({ chatNote: input.chatNote, vehicleTypes: input.vehicleTypes, note: input.note }) } })); }
