import { db } from "@/lib/db";
import { INITIAL_VEHICLE_STANDARDS } from "./initial-standards";

export function normalizeVehicleKey(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase("en-US").replace(/[‐‑–—\-_/.,()]/g, " ").replace(/\s+/g, " ").trim();
}

/** Idempotent import. Existing non-initial records are reported, never replaced. */
export async function importInitialVehicleStandards() {
  const result = { imported: 0, unchanged: 0, conflicts: [] as string[] };
  for (const item of INITIAL_VEHICLE_STANDARDS) {
    const existing = await db.vehicleModelStandard.findUnique({ where: { sourceKey: item.sourceKey } });
    // Import is seed-only: even an earlier imported row may subsequently have
    // been reviewed by an operator, so a repeat must never overwrite it.
    if (existing) {
      result.unchanged++;
      if (existing.source !== "THE_SHINE_车型标准.xlsx") result.conflicts.push(item.sourceKey);
      continue;
    }
    const data = {
      internalGrade: item.internalGrade,
      configurationLabel: item.description,
      representativeModels: item.aliases,
      normalizedName: item.aliases.length === 1 ? normalizeVehicleKey(item.aliases[0]) : null,
      brand: null,
      model: item.aliases.length === 1 ? item.aliases[0] : null,
      vehicleCategory: null,
      totalSeats: null,
      maxPassengers: item.passengers,
      maxStandardLuggage: item.luggage,
      countryScopeKey: item.scope,
      countryScopeLabel: item.countryLabel,
      luxury: item.internalGrade.startsWith("豪华") || item.internalGrade.startsWith("奢华"),
      source: "THE_SHINE_车型标准.xlsx",
      sourceReference: `车型标准!A${Number(item.sourceKey.slice(5)) + 1}:E${Number(item.sourceKey.slice(5)) + 1}`,
      originalRecord: { 车型中文: item.internalGrade, 车型描述: item.description, 座位描述: item.passengers, 行李描述: item.luggage, 适用国家: item.countryLabel },
      isConfirmed: true,
    };
    const standard = await db.vehicleModelStandard.create({ data: { sourceKey: item.sourceKey, ...data } });
    const capacity = await db.vehicleCapacityCombination.findUnique({ where: { vehicleStandardId_passengers_standardLuggage: { vehicleStandardId: standard.id, passengers: item.passengers, standardLuggage: item.luggage } } });
    if (capacity) {
      result.unchanged++;
    } else {
      await db.vehicleCapacityCombination.create({ data: { vehicleStandardId: standard.id, passengers: item.passengers, standardLuggage: item.luggage, outcome: "SUPPORTED", downwardCompatible: true, source: "THE_SHINE_车型标准.xlsx", sourceReference: item.sourceKey, isConfirmed: true } });
      result.imported++;
    }
    for (const displayName of item.aliases) {
      const normalizedName = normalizeVehicleKey(displayName);
      if (!normalizedName) continue;
      await db.vehicleModelStandardAlias.upsert({
        where: { vehicleStandardId_normalizedName: { vehicleStandardId: standard.id, normalizedName } },
        update: { displayName },
        create: { vehicleStandardId: standard.id, displayName, normalizedName },
      });
    }
  }
  return { ...result, totalSourceRows: INITIAL_VEHICLE_STANDARDS.length };
}

export async function listVehicleStandards() {
  return db.vehicleModelStandard.findMany({ include: { capacityCombinations: true, aliases: true }, orderBy: [{ internalGrade: "asc" }, { sourceKey: "asc" }] });
}
