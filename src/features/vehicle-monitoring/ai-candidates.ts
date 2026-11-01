import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { identifyVehicleFromImage } from "@/features/assist/service";
import { saveDriverDetails } from "@/features/iway/service";
import { reassessOrder } from "./assessment-service";
import { COUNTRY_SCOPES } from "./regions";
import { normalizeVehicleKey } from "./standards-service";

type CandidateSnapshot = { fullName?: string; confidence?: number | null; note?: string | null; matchedStandardId?: string | null };
export type CandidateAction = "CONFIRM_ORDER" | "REJECT" | "SAVE_STANDARD";
export type ReviewCandidateInput = { action: CandidateAction; orderId?: string; resolvedName?: string; note?: string; actor?: string; standard?: { countryScopeKey: string; countryScopeLabel?: string; internalGrade: string; configurationLabel: string; maxPassengers: number; maxStandardLuggage: number; capacityEvidence: string; downwardCompatible?: boolean; vehicleCategory?: string; confirmPlatformGrade?: boolean; platformGrade?: string; platformEvidence?: string } };

function candidateData(candidate: { candidates: unknown }) { return candidate.candidates as CandidateSnapshot; }
function resolvedCandidateName(candidate: { candidates: unknown }, name?: string) { const value = (name || candidateData(candidate).fullName || "").trim(); if (!value) throw new Error("VEHICLE_NAME_REQUIRED"); return value; }
function required(value: string | undefined, code: string) { if (!value?.trim()) throw new Error(code); return value.trim(); }

/** AI is a last resort. It never creates a standard or platform rule by itself. */
export async function findOrCreateAiCandidate(input: { imageUrl: string; orderId?: string; country?: string | null; platformGrade?: string | null; passengers?: number; luggage?: number }) {
  const requestSnapshot = { ...input, imageUrl: input.imageUrl.trim() };
  const cacheKey = createHash("sha256").update(JSON.stringify(requestSnapshot)).digest("hex");
  const cached = await db.aiVehicleCandidate.findUnique({ where: { cacheKey } });
  if (cached) return { ...cached, cacheHit: true };
  const vision = await identifyVehicleFromImage(input.imageUrl);
  const fullName = vision.value?.trim() ?? "";
  const known = fullName ? await db.vehicleModelStandardAlias.findFirst({ where: { normalizedName: normalizeVehicleKey(fullName) } }) : null;
  const candidate = await db.aiVehicleCandidate.create({ data: { cacheKey, requestSnapshot: requestSnapshot as Prisma.InputJsonValue, provider: vision.provider, status: known ? "REFERENCE_FOUND_REVIEW_REQUIRED" : "PENDING_REVIEW", candidates: { fullName, confidence: vision.confidence ?? null, note: vision.message, matchedStandardId: known?.vehicleStandardId ?? null } } });
  return { ...candidate, cacheHit: false };
}

export async function listAiVehicleCandidates() { return db.aiVehicleCandidate.findMany({ orderBy: { createdAt: "desc" }, take: 30 }); }

async function confirmForCurrentOrder(candidate: Awaited<ReturnType<typeof db.aiVehicleCandidate.findUniqueOrThrow>>, input: ReviewCandidateInput, name: string, actor: string) {
  const orderId = required(input.orderId, "ORDER_REQUIRED");
  const driver = await db.driverDetail.findUnique({ where: { orderId } });
  if (!driver) throw new Error("DRIVER_DETAILS_REQUIRED");
  // Uses the existing edit path: it preserves driver/plate data, records the
  // normal edit history, reassesses the order, and never sends iWay by itself.
  await saveDriverDetails(orderId, { rawReply: driver.rawReply ?? "", confirmedDriverName: driver.confirmedDriverName, rawDriverPhone: driver.rawDriverPhone, confirmedVehicleModel: name, confirmedVehicleCategory: driver.confirmedVehicleCategory, licensePlate: driver.licensePlate, rawLicensePlate: driver.licensePlate, changeType: "EDIT" });
  const updated = await db.aiVehicleCandidate.update({ where: { id: candidate.id }, data: { status: "ORDER_CONFIRMED", reviewedAt: new Date(), reviewedBy: actor, reviewAction: "CONFIRM_ORDER", reviewNote: input.note?.trim() || null, resolvedName: name, appliedOrderId: orderId } });
  return { candidate: updated, standard: null };
}

async function saveLongTermStandard(candidate: Awaited<ReturnType<typeof db.aiVehicleCandidate.findUniqueOrThrow>>, input: ReviewCandidateInput, name: string, actor: string) {
  const spec = input.standard;
  if (!spec) throw new Error("STANDARD_DETAILS_REQUIRED");
  const countryScopeKey = required(spec.countryScopeKey, "STANDARD_COUNTRY_REQUIRED");
  if (!(countryScopeKey in COUNTRY_SCOPES)) throw new Error("STANDARD_COUNTRY_SCOPE_INVALID");
  const internalGrade = required(spec.internalGrade, "STANDARD_INTERNAL_GRADE_REQUIRED");
  const configurationLabel = required(spec.configurationLabel, "STANDARD_CONFIGURATION_REQUIRED");
  const capacityEvidence = required(spec.capacityEvidence, "STANDARD_CAPACITY_EVIDENCE_REQUIRED");
  if (!Number.isInteger(spec.maxPassengers) || spec.maxPassengers < 1) throw new Error("STANDARD_PASSENGERS_INVALID");
  if (!Number.isInteger(spec.maxStandardLuggage) || spec.maxStandardLuggage < 0) throw new Error("STANDARD_LUGGAGE_INVALID");
  if (spec.confirmPlatformGrade && (!spec.platformGrade?.trim() || !spec.platformEvidence?.trim())) throw new Error("PLATFORM_EVIDENCE_REQUIRED");
  const standard = await db.$transaction(async (tx) => {
    const created = await tx.vehicleModelStandard.create({ data: { sourceKey: `AI_REVIEW_${candidate.id}`, internalGrade, configurationLabel, representativeModels: [name], normalizedName: normalizeVehicleKey(name), brand: null, model: name, vehicleCategory: spec.vehicleCategory?.trim() || null, totalSeats: null, maxPassengers: spec.maxPassengers, maxStandardLuggage: spec.maxStandardLuggage, countryScopeKey, countryScopeLabel: spec.countryScopeLabel?.trim() || null, luxury: null, source: "AI_CANDIDATE_MANUAL_CONFIRMATION", sourceReference: candidate.id, originalRecord: { candidateId: candidate.id, candidate: candidate.candidates, capacityEvidence, confirmedBy: actor, confirmedAt: new Date().toISOString() }, isConfirmed: true } });
    await tx.vehicleModelStandardAlias.create({ data: { vehicleStandardId: created.id, displayName: name, normalizedName: normalizeVehicleKey(name) } });
    await tx.vehicleCapacityCombination.create({ data: { vehicleStandardId: created.id, passengers: spec.maxPassengers, standardLuggage: spec.maxStandardLuggage, outcome: "SUPPORTED", downwardCompatible: Boolean(spec.downwardCompatible), source: "AI_CANDIDATE_MANUAL_CONFIRMATION", sourceReference: candidate.id, isConfirmed: true } });
    // Capacity approval is not platform approval. Platform mapping requires a
    // separate, deliberate evidence entry.
    if (spec.confirmPlatformGrade) await tx.platformVehicleGradeRule.create({ data: { platform: "IWAY", countryScopeKey, countryScopeLabel: spec.countryScopeLabel?.trim() || null, platformGrade: spec.platformGrade!.trim(), vehicleStandardId: created.id, outcome: "SUPPORTED", source: `AI_CANDIDATE_MANUAL_CONFIRMATION: ${spec.platformEvidence!.trim()}`, isConfirmed: true } });
    await tx.vehicleStandardAudit.create({ data: { vehicleStandardId: created.id, aiCandidateId: candidate.id, action: "CREATE_LONG_TERM_STANDARD", actor, note: input.note?.trim() || null, snapshot: { candidate: candidate.candidates, countryScopeKey, configurationLabel, capacityEvidence, downwardCompatible: Boolean(spec.downwardCompatible), platformRuleCreated: Boolean(spec.confirmPlatformGrade), platformEvidence: spec.confirmPlatformGrade ? spec.platformEvidence?.trim() : null } } });
    return created;
  });
  const updated = await db.aiVehicleCandidate.update({ where: { id: candidate.id }, data: { status: "STANDARD_CONFIRMED", reviewedAt: new Date(), reviewedBy: actor, reviewAction: "SAVE_STANDARD", reviewNote: input.note?.trim() || null, resolvedName: name, vehicleStandardId: standard.id } });
  const request = candidate.requestSnapshot as { orderId?: string };
  if (request.orderId) await reassessOrder(request.orderId, "AI_STANDARD_CONFIRMED");
  return { candidate: updated, standard };
}

export async function reviewAiVehicleCandidate(candidateId: string, input: ReviewCandidateInput) {
  const candidate = await db.aiVehicleCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  if (!["PENDING_REVIEW", "REFERENCE_FOUND_REVIEW_REQUIRED"].includes(candidate.status)) throw new Error("CANDIDATE_ALREADY_REVIEWED");
  const actor = input.actor?.trim() || "运营人员";
  if (input.action === "REJECT") {
    const updated = await db.aiVehicleCandidate.update({ where: { id: candidateId }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: actor, reviewAction: "REJECT", reviewNote: input.note?.trim() || null, resolvedName: input.resolvedName?.trim() || null, appliedOrderId: input.orderId ?? null } });
    if (input.orderId) await reassessOrder(input.orderId, "AI_CANDIDATE_REJECTED");
    return { candidate: updated, standard: null };
  }
  const name = resolvedCandidateName(candidate, input.resolvedName);
  return input.action === "CONFIRM_ORDER" ? confirmForCurrentOrder(candidate, input, name, actor) : saveLongTermStandard(candidate, input, name, actor);
}
