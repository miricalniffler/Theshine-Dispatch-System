import { db } from "@/lib/db";

export type VehicleArchiveInput = {
  rawPlate: string;
  brand?: string | null;
  model?: string | null;
  vehicleClass?: string | null;
  driverName?: string | null;
  normalizedPhone?: string | null;
  // This is a server-side provenance value. The public API never accepts it.
  source: "MANUAL_CONFIRMATION" | "ORDER_DRIVER_CONFIRMATION" | "AI_SUGGESTION";
};

export function normalizeVehicleArchivePlate(value: string | null | undefined) {
  return (value ?? "").normalize("NFC").trim().toUpperCase()
    .replace(/[‐‑‒–—―-]/g, "").replace(/\s+/g, "");
}

function clean(value: string | null | undefined) { return value?.trim() || null; }

export function shouldPreserveConfirmedArchive(existing: { confirmationStatus: string; rawPlate: string; brand: string | null; model: string | null; vehicleClass: string | null } | null, candidate: { rawPlate: string; brand: string | null; model: string | null; vehicleClass: string | null }) {
  if (existing?.confirmationStatus !== "CONFIRMED") return { preserve: false, conflict: false };
  const conflict = existing.rawPlate !== candidate.rawPlate || existing.brand !== candidate.brand || existing.model !== candidate.model || existing.vehicleClass !== candidate.vehicleClass;
  return { preserve: true, conflict };
}

export async function findVehicleArchive(rawPlate: string) {
  const normalizedPlate = normalizeVehicleArchivePlate(rawPlate);
  if (!normalizedPlate) return null;
  return db.vehicleArchive.findUnique({
    where: { normalizedPlate },
    include: { drivers: { orderBy: { lastSeenAt: "desc" }, take: 20 }, history: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
}

export async function saveVehicleArchive(input: Omit<VehicleArchiveInput, "source"> & { source?: VehicleArchiveInput["source"] }) {
  const rawPlate = input.rawPlate.trim();
  const normalizedPlate = normalizeVehicleArchivePlate(rawPlate);
  if (!normalizedPlate) throw new Error("PLATE_REQUIRED");
  const source = input.source ?? "MANUAL_CONFIRMATION";
  const isManual = source === "MANUAL_CONFIRMATION" || source === "ORDER_DRIVER_CONFIRMATION";

  return db.$transaction(async (tx) => {
    const existing = await tx.vehicleArchive.findUnique({ where: { normalizedPlate } });
    // A confirmed record is immutable through normal workflows. A different
    // raw spelling/model becomes a visible conflict history item instead of
    // silently changing the operational reference data.
    const candidate = { rawPlate, brand: clean(input.brand), model: clean(input.model), vehicleClass: clean(input.vehicleClass) };
    const { preserve: preserveConfirmed, conflict } = shouldPreserveConfirmedArchive(existing, candidate);
    const archive = existing
      ? await tx.vehicleArchive.update({
        where: { id: existing.id },
        data: preserveConfirmed ? {} : {
          ...candidate, confirmationStatus: isManual ? "CONFIRMED" : "SUGGESTED", source,
          confirmedAt: isManual ? new Date() : null,
        },
      })
      : await tx.vehicleArchive.create({ data: {
        normalizedPlate, ...candidate, confirmationStatus: isManual ? "CONFIRMED" : "SUGGESTED", source, confirmedAt: isManual ? new Date() : null,
      } });

    const driverName = clean(input.driverName);
    const normalizedPhone = clean(input.normalizedPhone);
    if (driverName || normalizedPhone) {
      const known = await tx.vehicleArchiveDriver.findFirst({ where: { vehicleArchiveId: archive.id, driverName, normalizedPhone } });
      if (known) await tx.vehicleArchiveDriver.update({ where: { id: known.id }, data: { lastSeenAt: new Date(), isConfirmed: known.isConfirmed || isManual } });
      else await tx.vehicleArchiveDriver.create({ data: { vehicleArchiveId: archive.id, driverName, normalizedPhone, source, isConfirmed: isManual } });
    }
    await tx.vehicleArchiveHistory.create({ data: {
      vehicleArchiveId: archive.id,
      action: conflict ? "档案冲突：保留已确认值" : preserveConfirmed ? "保留已确认档案，记录重复资料" : existing ? "更新车辆档案" : "创建车辆档案",
      source,
      snapshot: JSON.stringify({ ...candidate, driverName, normalizedPhone, conflict }),
    } });
    return { archive, conflictPreserved: preserveConfirmed };
  });
}
