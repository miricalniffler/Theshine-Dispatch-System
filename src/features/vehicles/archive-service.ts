import { db } from "@/lib/db";

export type VehicleArchiveInput = {
  rawPlate: string;
  brand?: string | null;
  model?: string | null;
  vehicleClass?: string | null;
  driverName?: string | null;
  normalizedPhone?: string | null;
  source: "MANUAL_CONFIRMATION" | "ORDER_DRIVER_CONFIRMATION" | "AI_SUGGESTION";
  // AI suggestions must never overwrite an already confirmed vehicle profile.
  replaceConfirmed?: boolean;
};

export function normalizeVehicleArchivePlate(value: string | null | undefined) {
  return (value ?? "").normalize("NFC").trim().toUpperCase()
    .replace(/[‐‑‒–—―-]/g, "").replace(/\s+/g, "");
}

function clean(value: string | null | undefined) { return value?.trim() || null; }

export async function findVehicleArchive(rawPlate: string) {
  const normalizedPlate = normalizeVehicleArchivePlate(rawPlate);
  if (!normalizedPlate) return null;
  return db.vehicleArchive.findUnique({
    where: { normalizedPlate },
    include: { drivers: { orderBy: { lastSeenAt: "desc" }, take: 20 }, history: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
}

export async function saveVehicleArchive(input: VehicleArchiveInput) {
  const rawPlate = input.rawPlate.trim();
  const normalizedPlate = normalizeVehicleArchivePlate(rawPlate);
  if (!normalizedPlate) throw new Error("PLATE_REQUIRED");
  const isManual = input.source === "MANUAL_CONFIRMATION" || input.source === "ORDER_DRIVER_CONFIRMATION";

  return db.$transaction(async (tx) => {
    const existing = await tx.vehicleArchive.findUnique({ where: { normalizedPlate } });
    const preserveConfirmed = existing?.confirmationStatus === "CONFIRMED" && !input.replaceConfirmed;
    const archive = existing
      ? await tx.vehicleArchive.update({
        where: { id: existing.id },
        data: preserveConfirmed ? { rawPlate } : {
          rawPlate, brand: clean(input.brand), model: clean(input.model), vehicleClass: clean(input.vehicleClass),
          confirmationStatus: isManual ? "CONFIRMED" : "SUGGESTED", source: input.source,
          confirmedAt: isManual ? new Date() : null,
        },
      })
      : await tx.vehicleArchive.create({ data: {
        normalizedPlate, rawPlate, brand: clean(input.brand), model: clean(input.model), vehicleClass: clean(input.vehicleClass),
        confirmationStatus: isManual ? "CONFIRMED" : "SUGGESTED", source: input.source, confirmedAt: isManual ? new Date() : null,
      } });

    const driverName = clean(input.driverName);
    const normalizedPhone = clean(input.normalizedPhone);
    if (driverName || normalizedPhone) {
      const known = await tx.vehicleArchiveDriver.findFirst({ where: { vehicleArchiveId: archive.id, driverName, normalizedPhone } });
      if (known) await tx.vehicleArchiveDriver.update({ where: { id: known.id }, data: { lastSeenAt: new Date(), isConfirmed: known.isConfirmed || isManual } });
      else await tx.vehicleArchiveDriver.create({ data: { vehicleArchiveId: archive.id, driverName, normalizedPhone, source: input.source, isConfirmed: isManual } });
    }
    await tx.vehicleArchiveHistory.create({ data: {
      vehicleArchiveId: archive.id,
      action: preserveConfirmed ? "保留已确认档案，记录新的候选资料" : existing ? "更新车辆档案" : "创建车辆档案",
      source: input.source,
      snapshot: JSON.stringify({ rawPlate, brand: clean(input.brand), model: clean(input.model), vehicleClass: clean(input.vehicleClass), driverName, normalizedPhone }),
    } });
    return { archive, conflictPreserved: preserveConfirmed };
  });
}
