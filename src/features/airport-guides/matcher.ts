export type AirportGuideMatchCandidate = {
  id: string;
  airportName: string;
  iataCode: string | null;
  terminal: string | null;
  isActive: boolean;
  aliases: { matchKind: "ALIAS" | "ADDRESS_KEYWORD"; normalizedValue: string }[];
};

export type AirportRecognition =
  | { kind: "AIRPORT_PICKUP_MATCHED"; airportName: string; guideId: string; matchedBy: "IATA" | "ALIAS" | "ADDRESS_KEYWORD" }
  | { kind: "AIRPORT_PICKUP_GUIDE_MISSING"; airportName: string; matchedBy: "IATA" | "ALIAS" | "ADDRESS_KEYWORD" }
  | { kind: "AIRPORT_DROPOFF"; airportName: string }
  | { kind: "NON_AIRPORT" }
  | { kind: "AIRPORT_LIKE_UNRESOLVED"; reason: "UNKNOWN_AIRPORT" | "AMBIGUOUS_AIRPORT" };

export function normalizeAirportText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function airportLike(value: string) {
  const normalized = normalizeAirportText(value);
  return /\b(airport|terminal|aeropuerto|aeroporto|aeroport)\b/i.test(normalized);
}

function uniqueCandidates(candidates: AirportGuideMatchCandidate[]) {
  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
}

function selectGuide(candidates: AirportGuideMatchCandidate[], matchedBy: "IATA" | "ALIAS" | "ADDRESS_KEYWORD") {
  const unique = uniqueCandidates(candidates);
  const active = unique.filter((candidate) => candidate.isActive);
  if (active.length === 1) return { state: "MATCHED" as const, candidate: active[0], matchedBy };
  if (active.length > 1) return { state: "AMBIGUOUS" as const };
  if (unique.length === 1) return { state: "MISSING" as const, candidate: unique[0], matchedBy };
  return unique.length > 1 ? { state: "AMBIGUOUS" as const } : { state: "NONE" as const };
}

function recognizeAddress(address: string, guides: AirportGuideMatchCandidate[]) {
  const normalized = normalizeAirportText(address);
  if (!normalized) return { state: "NONE" as const };
  const iataCodes = new Set((address.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []));
  const byIata = guides.filter((guide) => guide.iataCode && iataCodes.has(guide.iataCode));
  const iataResult = selectGuide(byIata, "IATA");
  if (iataResult.state !== "NONE") return iataResult;

  for (const matchKind of ["ALIAS", "ADDRESS_KEYWORD"] as const) {
    const matched = guides.filter((guide) => guide.aliases.some((alias) => alias.matchKind === matchKind && alias.normalizedValue.length >= 3 && normalized.includes(alias.normalizedValue)));
    const result = selectGuide(matched, matchKind);
    if (result.state !== "NONE") return result;
  }
  return airportLike(address) ? { state: "AIRPORT_LIKE" as const } : { state: "NONE" as const };
}

/**
 * This matcher is intentionally pure and deterministic: no AI call, no database
 * write, and no guess when one address maps to more than one active guide.
 */
export function recognizeAirportForOrder(input: { pickupAddress: string; dropoffAddress: string; guides: AirportGuideMatchCandidate[] }): AirportRecognition {
  const pickup = recognizeAddress(input.pickupAddress, input.guides);
  if (pickup.state === "MATCHED") return { kind: "AIRPORT_PICKUP_MATCHED", airportName: pickup.candidate.airportName, guideId: pickup.candidate.id, matchedBy: pickup.matchedBy };
  if (pickup.state === "MISSING") return { kind: "AIRPORT_PICKUP_GUIDE_MISSING", airportName: pickup.candidate.airportName, matchedBy: pickup.matchedBy };
  if (pickup.state === "AMBIGUOUS") return { kind: "AIRPORT_LIKE_UNRESOLVED", reason: "AMBIGUOUS_AIRPORT" };
  if (pickup.state === "AIRPORT_LIKE") return { kind: "AIRPORT_LIKE_UNRESOLVED", reason: "UNKNOWN_AIRPORT" };

  const dropoff = recognizeAddress(input.dropoffAddress, input.guides);
  if (dropoff.state === "MATCHED" || dropoff.state === "MISSING") return { kind: "AIRPORT_DROPOFF", airportName: dropoff.candidate.airportName };
  return { kind: "NON_AIRPORT" };
}
