import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { identifyVehicleFromImage } from "@/features/assist/service";
import { normalizeVehicleKey } from "./standards-service";

/**
 * AI is a last resort.  This function first looks for an explicitly-confirmed
 * alias, then reuses the same unresolved query, and only then asks vision.
 * It never writes VehicleModelStandard or a platform rule.
 */
export async function findOrCreateAiCandidate(input: { imageUrl: string; country?: string | null; platformGrade?: string | null; passengers?: number; luggage?: number }) {
  const requestSnapshot = { ...input, imageUrl: input.imageUrl.trim() };
  const cacheKey = createHash("sha256").update(JSON.stringify(requestSnapshot)).digest("hex");
  const cached = await db.aiVehicleCandidate.findUnique({ where: { cacheKey } });
  if (cached) return cached;
  const vision = await identifyVehicleFromImage(input.imageUrl);
  const fullName = vision.value?.trim() ?? "";
  const known = fullName ? await db.vehicleModelStandardAlias.findFirst({ where: { normalizedName: normalizeVehicleKey(fullName) }, include: { vehicleStandard: true } }) : null;
  return db.aiVehicleCandidate.create({ data: {
    cacheKey, requestSnapshot, provider: vision.provider, status: known ? "REFERENCE_FOUND_REVIEW_REQUIRED" : "PENDING_REVIEW",
    candidates: { fullName, confidence: vision.confidence ?? null, note: vision.message, matchedStandardId: known?.vehicleStandardId ?? null },
  } });
}
