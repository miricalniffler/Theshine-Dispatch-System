import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeLicensePlateForReturn, normalizeThailandPhone } from "@/lib/rules/engine";
import { loadRules } from "@/lib/rules/load-rules";

const temporaryThaiMaleNames = ["Somchai", "Anan", "Niran", "Kittipong", "Prasert", "Somsak", "Chai", "Wichai", "Thanawat", "Preecha"];

export type DriverNameSource = "MANUAL" | "AI_TRANSLITERATED" | "TEMPORARY" | "UNKNOWN";
export type ArchiveInput = {
  orderId: string;
  orderStatus: string;
  existingDriverProfileId?: string | null;
  existingVehicleProfileId?: string | null;
  driverName?: string | null;
  thaiDriverName?: string | null;
  driverNameSource?: string | null;
  rawPhone?: string | null;
  vehicleModel?: string | null;
  vehicleCategory?: string | null;
  rawPlate?: string | null;
};

function meaningfulName(value?: string | null) {
  const name = value?.trim() || "";
  return name && name !== "无名氏" ? name : null;
}

function normalizedPlate(value?: string | null) {
  const plate = normalizeLicensePlateForReturn(value);
  return plate ? plate.replace(/[\s-]/g, "").toLocaleUpperCase("th-TH") : null;
}

function hash(value: string) {
  let total = 0;
  for (const char of value) total = (total * 31 + char.charCodeAt(0)) >>> 0;
  return total;
}

function nameSource(input: ArchiveInput, actualName: string | null): DriverNameSource {
  if (!actualName) return "TEMPORARY";
  if (input.driverNameSource === "AI_TRANSLITERATED") return "AI_TRANSLITERATED";
  return "MANUAL";
}

async function rootProfile(tx: Prisma.TransactionClient, id: string) {
  let profile = await tx.driverProfile.findUnique({ where: { id } });
  const seen = new Set<string>();
  while (profile?.mergedIntoId && !seen.has(profile.id)) {
    seen.add(profile.id);
    profile = await tx.driverProfile.findUnique({ where: { id: profile.mergedIntoId } });
  }
  return profile;
}

async function stableTemporaryName(tx: Prisma.TransactionClient, driverProfileId: string, orderId: string) {
  const existing = await tx.temporaryDriverName.findUnique({ where: { orderId } });
  if (existing) return existing.generatedName;
  const generatedName = temporaryThaiMaleNames[hash(`${driverProfileId}:${orderId}`) % temporaryThaiMaleNames.length];
  await tx.temporaryDriverName.create({ data: { driverProfileId, orderId, generatedName } });
  return generatedName;
}

/**
 * Called only when an operator saves driver/vehicle details after this feature
 * is released. It never scans or backfills historical orders.
 */
export async function archiveDriverVehicle(tx: Prisma.TransactionClient, input: ArchiveInput) {
  const rules = loadRules();
  const actualName = meaningfulName(input.driverName);
  const thaiName = input.thaiDriverName?.trim() || null;
  const normalizedPhone = normalizeThailandPhone(input.rawPhone, rules);
  const normalizedVehiclePlate = normalizedPlate(input.rawPlate);
  const source = nameSource(input, actualName);

  let driver = input.existingDriverProfileId ? await rootProfile(tx, input.existingDriverProfileId) : null;
  if (!driver && normalizedPhone) {
    const phone = await tx.driverPhone.findUnique({ where: { normalizedPhone }, include: { driverProfile: true } });
    if (phone) driver = await rootProfile(tx, phone.driverProfileId);
  }
  if (!driver) {
    driver = await tx.driverProfile.create({
      data: {
        displayName: actualName || "无名氏",
        thaiName,
        confirmedEnglishName: actualName,
        nameSource: source,
        nameHistory: actualName ? { create: { name: actualName, nameSource: source, thaiName } } : undefined,
      },
    });
  } else if (actualName && driver.displayName === "无名氏") {
    driver = await tx.driverProfile.update({
      where: { id: driver.id },
      data: { displayName: actualName, confirmedEnglishName: actualName, thaiName: thaiName || driver.thaiName, nameSource: source, nameHistory: { create: { name: actualName, nameSource: source, thaiName } } },
    });
  }

  if (normalizedPhone) {
    const existingPhone = await tx.driverPhone.findUnique({ where: { normalizedPhone } });
    if (!existingPhone) await tx.driverPhone.create({ data: { driverProfileId: driver.id, rawPhone: input.rawPhone?.trim() || normalizedPhone, normalizedPhone } });
    else if (existingPhone.driverProfileId !== driver.id) throw new Error("DRIVER_PHONE_CONFLICT");
  }

  let vehicle = input.existingVehicleProfileId ? await tx.vehicleProfile.findUnique({ where: { id: input.existingVehicleProfileId } }) : null;
  if (!vehicle && normalizedVehiclePlate) vehicle = await tx.vehicleProfile.findUnique({ where: { normalizedPlate: normalizedVehiclePlate } });
  if (!vehicle && normalizedVehiclePlate) {
    const vehicleModel = input.vehicleModel?.trim() || null;
    vehicle = await tx.vehicleProfile.create({ data: { rawLicensePlate: input.rawPlate?.trim() || null, normalizedPlate: normalizedVehiclePlate, vehicleModel, vehicleCategory: input.vehicleCategory?.trim() || null, brand: vehicleModel?.split(/\s+/)[0] || null, dataSource: "MANUAL", isVerified: true } });
  } else if (vehicle && !vehicle.isVerified && input.vehicleModel?.trim()) {
    vehicle = await tx.vehicleProfile.update({ where: { id: vehicle.id }, data: { rawLicensePlate: input.rawPlate?.trim() || vehicle.rawLicensePlate, vehicleModel: input.vehicleModel.trim(), vehicleCategory: input.vehicleCategory?.trim() || vehicle.vehicleCategory, brand: input.vehicleModel.trim().split(/\s+/)[0] || vehicle.brand, dataSource: "MANUAL", isVerified: true } });
  }

  const iwayDriverName = actualName || await stableTemporaryName(tx, driver.id, input.orderId);
  const active = await tx.orderDriverVehicleAssignment.findFirst({ where: { orderId: input.orderId, isCurrent: true }, orderBy: { assignedAt: "desc" } });
  const changed = !active || active.driverProfileId !== driver.id || active.vehicleProfileId !== vehicle?.id || active.driverNameForIway !== iwayDriverName || active.driverNameSource !== source;
  if (changed) {
    await tx.orderDriverVehicleAssignment.updateMany({ where: { orderId: input.orderId, isCurrent: true }, data: { isCurrent: false, endedAt: new Date(), endReason: "司机或车辆资料已更新" } });
    await tx.orderDriverVehicleAssignment.create({ data: { orderId: input.orderId, driverProfileId: driver.id, vehicleProfileId: vehicle?.id, driverNameForIway: iwayDriverName, driverNameSource: source, orderStatus: input.orderStatus } });
  }
  return { driverProfileId: driver.id, vehicleProfileId: vehicle?.id || null, normalizedPhone, normalizedPlate: normalizedVehiclePlate, driverNameSource: source, iwayDriverName, displayName: driver.displayName };
}

export function isTemporaryName(source?: string | null) { return source === "TEMPORARY"; }

export async function listDriverProfiles(query = "") {
  const needle = query.trim();
  const profiles = await db.driverProfile.findMany({
    where: { mergedIntoId: null, ...(needle ? { OR: [{ id: { contains: needle } }, { displayName: { contains: needle, mode: "insensitive" } }, { phones: { some: { OR: [{ rawPhone: { contains: needle } }, { normalizedPhone: { contains: needle } }] } } }] } : {}) },
    include: { phones: true, assignments: { include: { vehicleProfile: true, order: { select: { platformOrderNumber: true, serviceDate: true, status: true } } }, orderBy: { assignedAt: "desc" }, take: 20 }, temporaryNames: { orderBy: { createdAt: "desc" }, take: 20 } }, orderBy: { updatedAt: "desc" }, take: 100,
  });
  return profiles.map((profile) => ({ ...profile, counts: { arranged: profile.assignments.filter((item) => item.order.status !== "CANCELLED" && item.order.status !== "COMPLETED").length, completed: profile.assignments.filter((item) => item.order.status === "COMPLETED").length, cancelled: profile.assignments.filter((item) => item.order.status === "CANCELLED").length } }));
}

export async function listVehicleProfiles(query = "") {
  const needle = query.trim();
  return db.vehicleProfile.findMany({ where: needle ? { OR: [{ rawLicensePlate: { contains: needle, mode: "insensitive" } }, { normalizedPlate: { contains: needle, mode: "insensitive" } }, { vehicleModel: { contains: needle, mode: "insensitive" } }] } : {}, include: { assignments: { include: { driverProfile: true, order: { select: { platformOrderNumber: true, serviceDate: true, status: true } } }, orderBy: { assignedAt: "desc" }, take: 30 } }, orderBy: { updatedAt: "desc" }, take: 100 });
}

export async function addDriverPhone(driverProfileId: string, rawPhone: string) {
  const normalizedPhone = normalizeThailandPhone(rawPhone, loadRules());
  if (!normalizedPhone) throw new Error("INVALID_PHONE");
  const existing = await db.driverPhone.findUnique({ where: { normalizedPhone } });
  if (existing && existing.driverProfileId !== driverProfileId) throw new Error("DRIVER_PHONE_CONFLICT");
  return existing ?? db.driverPhone.create({ data: { driverProfileId, rawPhone: rawPhone.trim(), normalizedPhone } });
}

export async function mergeDriverProfiles(sourceProfileId: string, targetProfileId: string) {
  if (!sourceProfileId || sourceProfileId === targetProfileId) throw new Error("INVALID_MERGE");
  const [source, target] = await Promise.all([db.driverProfile.findUnique({ where: { id: sourceProfileId }, include: { phones: true, assignments: true } }), db.driverProfile.findUnique({ where: { id: targetProfileId }, include: { phones: true, assignments: true } })]);
  if (!source || !target || source.mergedIntoId || target.mergedIntoId) throw new Error("PROFILE_NOT_AVAILABLE");
  const targetNumbers = new Set(target.phones.map((phone) => phone.normalizedPhone));
  const conflicts = source.phones.filter((phone) => targetNumbers.has(phone.normalizedPhone));
  if (conflicts.length) return { merged: false, conflicts: conflicts.map((phone) => phone.normalizedPhone), source, target };
  await db.$transaction(async (tx) => {
    await tx.driverPhone.updateMany({ where: { driverProfileId: source.id }, data: { driverProfileId: target.id } });
    await tx.driverProfile.update({ where: { id: source.id }, data: { mergedIntoId: target.id } });
    await tx.driverProfileMerge.create({ data: { sourceProfileId: source.id, targetProfileId: target.id, operator: "运营人员", summary: `合并手机号 ${source.phones.length} 个；历史订单搭配保留原档案归属。` } });
  });
  return { merged: true, conflicts: [] };
}

export async function updateDriverProfile(driverProfileId: string, input: { displayName?: string; thaiName?: string | null; confirmedEnglishName?: string | null }) {
  const displayName = input.displayName?.trim();
  if (!displayName) throw new Error("INVALID_DRIVER_NAME");
  return db.$transaction(async (tx) => {
    const before = await tx.driverProfile.findUnique({ where: { id: driverProfileId } });
    if (!before || before.mergedIntoId) throw new Error("PROFILE_NOT_AVAILABLE");
    const updated = await tx.driverProfile.update({ where: { id: driverProfileId }, data: { displayName, thaiName: input.thaiName?.trim() || null, confirmedEnglishName: input.confirmedEnglishName?.trim() || null, nameSource: "MANUAL" } });
    await tx.driverNameHistory.create({ data: { driverProfileId, name: displayName, nameSource: "MANUAL", thaiName: updated.thaiName } });
    return updated;
  });
}

export async function updateVehicleProfile(vehicleProfileId: string, input: { rawLicensePlate?: string | null; vehicleModel?: string | null; vehicleCategory?: string | null; brand?: string | null }) {
  const current = await db.vehicleProfile.findUnique({ where: { id: vehicleProfileId } });
  if (!current) throw new Error("VEHICLE_NOT_FOUND");
  const rawLicensePlate = input.rawLicensePlate?.trim() || current.rawLicensePlate;
  const normalized = normalizedPlate(rawLicensePlate);
  if (normalized && normalized !== current.normalizedPlate) {
    const duplicate = await db.vehicleProfile.findUnique({ where: { normalizedPlate: normalized } });
    if (duplicate && duplicate.id !== current.id) throw new Error("VEHICLE_PLATE_CONFLICT");
  }
  return db.vehicleProfile.update({ where: { id: vehicleProfileId }, data: { rawLicensePlate: rawLicensePlate || null, normalizedPlate: normalized, vehicleModel: input.vehicleModel?.trim() || null, vehicleCategory: input.vehicleCategory?.trim() || null, brand: input.brand?.trim() || null, dataSource: "MANUAL", isVerified: true } });
}

