import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { scopeMatches, scopeSpecificity } from "./regions";
import { normalizeVehicleKey } from "./standards-service";

export type AssessmentStatus = "COMPLIANT" | "REVIEW_REQUIRED" | "NON_COMPLIANT";
type OrderForAssessment = {
  id: string; platformOrderNumber: string; platformVehicleType: string; adults: number; children: number; luggage: number;
  luggageSource: string; serviceCountry: string | null; driverDetail: { confirmedVehicleModel: string | null; confirmedVehicleCategory: string | null } | null;
};

// The existing local/demo repository deliberately runs without PostgreSQL.
// Vehicle monitoring is additive: it must never make saving a fleet reply or
// generating an existing iWay preview fail merely because that optional
// persistence layer is unavailable.
export function isVehicleMonitoringAvailable() {
  return Boolean(process.env.DATABASE_URL);
}

export type CapacityCombinationForAssessment = { passengers: number; standardLuggage: number; outcome: string; isConfirmed: boolean; downwardCompatible: boolean };

/** A confirmed combination may explicitly cover smaller passenger/luggage
 * counts; unknown combinations are never inferred from unrelated models. */
export function supportsCapacityCombination(combinations: CapacityCombinationForAssessment[], passengers: number, luggage: number) {
  return combinations.some((item) => item.isConfirmed && item.outcome === "SUPPORTED" && item.downwardCompatible && item.passengers >= passengers && item.standardLuggage >= luggage);
}

function inputFingerprint(order: OrderForAssessment) {
  return JSON.stringify({ vehicle: normalizeVehicleKey(order.driverDetail?.confirmedVehicleModel), passengers: order.adults + order.children, luggage: order.luggage, luggageSource: order.luggageSource, country: order.serviceCountry, platformGrade: order.platformVehicleType });
}

async function compute(order: OrderForAssessment) {
  const passengers = order.adults + order.children;
  const vehicle = order.driverDetail?.confirmedVehicleModel;
  const reasons: string[] = [];
  const raw = { vehicle, passengers, luggage: order.luggage, luggageSource: order.luggageSource, country: order.serviceCountry, platformGrade: order.platformVehicleType };
  if (!vehicle) return { status: "REVIEW_REQUIRED" as const, reasons: ["尚未保存实际车型。"], raw, policyFingerprint: "NO_VEHICLE", standard: null };
  if (!order.serviceCountry) reasons.push("订单所在国家未确认，不能安全选择国家车型标准。");
  const aliases = await db.vehicleModelStandardAlias.findMany({ where: { normalizedName: normalizeVehicleKey(vehicle) }, include: { vehicleStandard: { include: { capacityCombinations: true } } } });
  const applicable = aliases.filter((alias) => scopeMatches(alias.vehicleStandard.countryScopeKey, order.serviceCountry));
  if (!applicable.length) reasons.push("该具体车型没有可用的已确认运营标准。");
  const maxSpecificity = Math.max(-1, ...applicable.map((item) => scopeSpecificity(item.vehicleStandard.countryScopeKey)));
  const preferred = applicable.filter((item) => scopeSpecificity(item.vehicleStandard.countryScopeKey) === maxSpecificity);
  if (preferred.length > 1) reasons.push("存在多个同等优先级的车型配置，需人工选择。");
  const standard = preferred.length === 1 ? preferred[0].vehicleStandard : null;
  if (standard) {
    if (!supportsCapacityCombination(standard.capacityCombinations, passengers, order.luggage)) reasons.push(`已确认的 ${standard.internalGrade} 配置最多同时承诺 ${standard.maxPassengers} 人与 ${standard.maxStandardLuggage} 件标准行李。`);
  }
  if (order.luggageSource === "UNKNOWN") reasons.push("行李数量来源未知；历史 0 件不能视为客人明确无行李。");
  const grade = standard ? await db.platformVehicleGradeRule.findFirst({ where: { platform: "IWAY", platformGrade: order.platformVehicleType, vehicleStandardId: standard.id, isConfirmed: true, countryScopeKey: standard.countryScopeKey } }) : null;
  if (!grade) reasons.push("iWay 平台等级尚无已确认的独立映射。");
  const failedCapacity = Boolean(standard && !supportsCapacityCombination(standard.capacityCombinations, passengers, order.luggage));
  // Include all confirmed policy facts that affect this decision. This makes a
  // later capacity/grade/standard edit create a fresh assessment and expire a
  // prior one-time override, without treating a mere driver-name or plate edit
  // as a policy change.
  const policyFingerprint = JSON.stringify({
    aliases: applicable.map((item) => ({ id: item.vehicleStandard.id, version: item.vehicleStandard.version, updatedAt: item.vehicleStandard.updatedAt.toISOString(), capacities: item.vehicleStandard.capacityCombinations.map((capacity) => ({ id: capacity.id, updatedAt: capacity.updatedAt.toISOString(), confirmed: capacity.isConfirmed, outcome: capacity.outcome, passengers: capacity.passengers, luggage: capacity.standardLuggage, downwardCompatible: capacity.downwardCompatible })).sort((a, b) => a.id.localeCompare(b.id)) })).sort((a, b) => a.id.localeCompare(b.id)),
    grade: grade ? { id: grade.id, version: grade.version, updatedAt: grade.updatedAt.toISOString(), outcome: grade.outcome, scope: grade.countryScopeKey } : null,
  });
  return { status: failedCapacity ? "NON_COMPLIANT" as const : reasons.length ? "REVIEW_REQUIRED" as const : "COMPLIANT" as const, reasons, raw, policyFingerprint, standard: standard ? { id: standard.id, sourceKey: standard.sourceKey, internalGrade: standard.internalGrade, scope: standard.countryScopeKey, maxPassengers: standard.maxPassengers, maxStandardLuggage: standard.maxStandardLuggage } : null };
}

export async function reassessOrder(orderId: string, trigger: string) {
  if (!isVehicleMonitoringAvailable()) return null;
  const order = await db.order.findUnique({ where: { id: orderId }, include: { driverDetail: true } });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const input = order as OrderForAssessment;
  // Policy data is intentionally evaluated before reusing a current record.
  // Standards can change independently of an order and must invalidate a
  // previously approved assessment/override.
  const outcome = await compute(input);
  const nextFingerprint = JSON.stringify({ input: inputFingerprint(input), policy: outcome.policyFingerprint });
  const current = await db.orderVehicleAssessment.findFirst({ where: { orderId, isCurrent: true }, orderBy: { createdAt: "desc" } });
  if (current?.fingerprint === nextFingerprint) return current;
  return db.$transaction(async (tx) => {
    await tx.orderVehicleAssessment.updateMany({ where: { orderId, isCurrent: true }, data: { isCurrent: false, invalidatedAt: new Date() } });
    // A release belongs to the exact reviewed vehicle/passenger/luggage state.
    await tx.orderVehicleOverride.updateMany({ where: { orderId, isActive: true }, data: { isActive: false, invalidatedAt: new Date() } });
    return tx.orderVehicleAssessment.create({ data: { orderId, status: outcome.status, reason: outcome.reasons.join(" "), fingerprint: nextFingerprint, trigger, inputSnapshot: outcome.raw as Prisma.InputJsonValue, resultSnapshot: { standard: outcome.standard, reasons: outcome.reasons, policyFingerprint: outcome.policyFingerprint } as Prisma.InputJsonValue, standardVersion: outcome.standard?.sourceKey ?? null } });
  });
}

export async function releaseOrderVehicle(orderId: string, reason: string) {
  if (!isVehicleMonitoringAvailable()) throw new Error("VEHICLE_MONITORING_UNAVAILABLE");
  if (!reason.trim()) throw new Error("OVERRIDE_REASON_REQUIRED");
  const assessment = await reassessOrder(orderId, "OVERRIDE_REQUEST");
  if (!assessment) throw new Error("VEHICLE_MONITORING_UNAVAILABLE");
  return db.orderVehicleOverride.create({ data: { orderId, reason: reason.trim(), assessmentId: assessment.id, inputSnapshot: assessment.inputSnapshot as Prisma.InputJsonValue } });
}

export async function getIwayVehicleGate(orderId: string) {
  if (!isVehicleMonitoringAvailable()) return { allowed: true, warning: null, reason: null };
  const assessment = await reassessOrder(orderId, "IWAY_GATE");
  if (!assessment) return { allowed: true, warning: null, reason: null };
  const activeOverride = await db.orderVehicleOverride.findFirst({ where: { orderId, isActive: true, assessmentId: assessment.id }, orderBy: { createdAt: "desc" } });
  if (assessment.status === "NON_COMPLIANT" && !activeOverride) return { allowed: false, warning: null, reason: assessment.reason || "车型不符合已确认标准。" };
  if (assessment.status === "REVIEW_REQUIRED") return { allowed: true, warning: assessment.reason || "车型资料待核对。", reason: null };
  return { allowed: true, warning: activeOverride ? `已单次放行：${activeOverride.reason}` : null, reason: null };
}

export async function listVehicleMonitoring() {
  return db.order.findMany({
    where: { status: { notIn: ["CANCELLED", "COMPLETED"] } },
    include: { driverDetail: true, vehicleAssessments: { where: { isCurrent: true }, take: 1, orderBy: { createdAt: "desc" } }, vehicleOverrides: { where: { isActive: true }, take: 1, orderBy: { createdAt: "desc" } } },
    orderBy: { pickupDateTime: "asc" },
  });
}
