import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { scopeMatches, scopeSpecificity } from "./regions";
import { normalizeVehicleKey } from "./standards-service";

export type AssessmentStatus = "COMPLIANT" | "REVIEW_REQUIRED" | "NON_COMPLIANT";
type OrderForAssessment = {
  id: string; platformOrderNumber: string; platformVehicleType: string; adults: number; children: number; luggage: number;
  luggageSource: string; serviceCountry: string | null; driverDetail: { confirmedVehicleModel: string | null; confirmedVehicleCategory: string | null } | null;
};

function fingerprint(order: OrderForAssessment) {
  return JSON.stringify({ vehicle: normalizeVehicleKey(order.driverDetail?.confirmedVehicleModel), passengers: order.adults + order.children, luggage: order.luggage, luggageSource: order.luggageSource, country: order.serviceCountry, platformGrade: order.platformVehicleType });
}

async function compute(order: OrderForAssessment) {
  const passengers = order.adults + order.children;
  const vehicle = order.driverDetail?.confirmedVehicleModel;
  const reasons: string[] = [];
  const raw = { vehicle, passengers, luggage: order.luggage, luggageSource: order.luggageSource, country: order.serviceCountry, platformGrade: order.platformVehicleType };
  if (!vehicle) return { status: "REVIEW_REQUIRED" as const, reasons: ["尚未保存实际车型。"], raw, standard: null };
  if (!order.serviceCountry) reasons.push("订单所在国家未确认，不能安全选择国家车型标准。");
  const aliases = await db.vehicleModelStandardAlias.findMany({ where: { normalizedName: normalizeVehicleKey(vehicle) }, include: { vehicleStandard: { include: { capacityCombinations: true } } } });
  const applicable = aliases.filter((alias) => scopeMatches(alias.vehicleStandard.countryScopeKey, order.serviceCountry));
  if (!applicable.length) reasons.push("该具体车型没有可用的已确认运营标准。");
  const maxSpecificity = Math.max(-1, ...applicable.map((item) => scopeSpecificity(item.vehicleStandard.countryScopeKey)));
  const preferred = applicable.filter((item) => scopeSpecificity(item.vehicleStandard.countryScopeKey) === maxSpecificity);
  if (preferred.length > 1) reasons.push("存在多个同等优先级的车型配置，需人工选择。");
  const standard = preferred.length === 1 ? preferred[0].vehicleStandard : null;
  if (standard) {
    const capacity = standard.capacityCombinations.find((item) => item.isConfirmed && item.outcome === "SUPPORTED" && (item.passengers >= passengers && item.standardLuggage >= order.luggage) && item.downwardCompatible);
    if (!capacity) reasons.push(`已确认的 ${standard.internalGrade} 配置最多同时承诺 ${standard.maxPassengers} 人与 ${standard.maxStandardLuggage} 件标准行李。`);
  }
  if (order.luggageSource === "UNKNOWN") reasons.push("行李数量来源未知；历史 0 件不能视为客人明确无行李。");
  const grade = standard ? await db.platformVehicleGradeRule.findFirst({ where: { platform: "IWAY", platformGrade: order.platformVehicleType, vehicleStandardId: standard.id, isConfirmed: true, countryScopeKey: standard.countryScopeKey } }) : null;
  if (!grade) reasons.push("iWay 平台等级尚无已确认的独立映射。");
  const failedCapacity = Boolean(standard && !standard.capacityCombinations.some((item) => item.isConfirmed && item.outcome === "SUPPORTED" && item.downwardCompatible && item.passengers >= passengers && item.standardLuggage >= order.luggage));
  return { status: failedCapacity ? "NON_COMPLIANT" as const : reasons.length ? "REVIEW_REQUIRED" as const : "COMPLIANT" as const, reasons, raw, standard: standard ? { id: standard.id, sourceKey: standard.sourceKey, internalGrade: standard.internalGrade, scope: standard.countryScopeKey, maxPassengers: standard.maxPassengers, maxStandardLuggage: standard.maxStandardLuggage } : null };
}

export async function reassessOrder(orderId: string, trigger: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { driverDetail: true } });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const input = order as OrderForAssessment;
  const nextFingerprint = fingerprint(input);
  const current = await db.orderVehicleAssessment.findFirst({ where: { orderId, isCurrent: true }, orderBy: { createdAt: "desc" } });
  if (current?.fingerprint === nextFingerprint) return current;
  const outcome = await compute(input);
  return db.$transaction(async (tx) => {
    await tx.orderVehicleAssessment.updateMany({ where: { orderId, isCurrent: true }, data: { isCurrent: false, invalidatedAt: new Date() } });
    // A release belongs to the exact reviewed vehicle/passenger/luggage state.
    await tx.orderVehicleOverride.updateMany({ where: { orderId, isActive: true }, data: { isActive: false, invalidatedAt: new Date() } });
    return tx.orderVehicleAssessment.create({ data: { orderId, status: outcome.status, reason: outcome.reasons.join(" "), fingerprint: nextFingerprint, trigger, inputSnapshot: outcome.raw as Prisma.InputJsonValue, resultSnapshot: { standard: outcome.standard, reasons: outcome.reasons } as Prisma.InputJsonValue, standardVersion: outcome.standard?.sourceKey ?? null } });
  });
}

export async function releaseOrderVehicle(orderId: string, reason: string) {
  if (!reason.trim()) throw new Error("OVERRIDE_REASON_REQUIRED");
  const assessment = await reassessOrder(orderId, "OVERRIDE_REQUEST");
  return db.orderVehicleOverride.create({ data: { orderId, reason: reason.trim(), assessmentId: assessment.id, inputSnapshot: assessment.inputSnapshot as Prisma.InputJsonValue } });
}

export async function getIwayVehicleGate(orderId: string) {
  const assessment = await reassessOrder(orderId, "IWAY_GATE");
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
