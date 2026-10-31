import type { FieldValidationResult, TemplateContext } from "@/types/domain";
import { loadRules } from "./load-rules";
import type { RuleValidationScope, RulesConfig } from "./types";

const placeholderPattern = /{{\s*([a-zA-Z0-9_]+)(?:\|([a-z_]+)(?:\(([^)]*)\))?)?\s*}}/g;

function parseArgument(argument: string | undefined) {
  if (!argument) return undefined;
  const value = argument.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) return value.slice(1, -1);
  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? value : numberValue;
}

function printable(value: TemplateContext[string]) {
  return value === null || value === undefined ? "" : String(value);
}

/** Renders the restricted, YAML-only template syntax: default(), prefix(), omit_if_empty. */
export function renderTemplate(template: string, context: TemplateContext) {
  return template
    .replace(placeholderPattern, (_matched, field: string, filter?: string, rawArgument?: string) => {
      const value = context[field];
      const empty = value === null || value === undefined || value === "";
      const argument = parseArgument(rawArgument);
      if (!filter) return printable(value);
      if (filter === "default") return empty ? printable(argument) : printable(value);
      if (filter === "prefix") return empty ? "" : `${printable(argument)}${printable(value)}`;
      if (filter === "omit_if_empty") return empty ? "" : printable(value);
      throw new Error(`Unsupported rule-template filter: ${filter}`);
    })
    // Optional YAML lines that render empty must not leave visual gaps inside
    // one order. Batch orders are still separated later by two newlines.
    .replace(/\n[ \t]*\n+/g, "\n")
    .trim();
}

export function validateRequiredFields(
  record: Record<string, unknown>,
  scope: RuleValidationScope,
  rules: RulesConfig = loadRules(),
): FieldValidationResult {
  const missingFields = rules.validation[scope].filter((field) => {
    const value = record[field];
    return value === null || value === undefined || value === "";
  });
  return { valid: missingFields.length === 0, missingFields };
}

export function normalizeThailandPhone(phone: string | null | undefined, rules: RulesConfig = loadRules()) {
  if (!phone) return null;
  const config = rules.transforms.phone.thailand;
  const normalizeOne = (original: string) => {
    const value = original.trim().replace(/^\+\s*66/, "+66");
    const countryCode = config.country_code;
    if (value.startsWith(countryCode)) {
      const suffix = value.slice(countryCode.length);
      const nationalDigits = suffix.replace(/\D/g, "");
      if (!config.local_digit_lengths.includes(nationalDigits.replace(/^0/, "").length)) return null;
      // 保留车队原来的空格、横杠；仅去掉国家码后的本地前导 0。
      return `${countryCode}${suffix.replace(/^(\s|-)*0/, "$1")}`;
    }
    const digits = value.replace(/\D/g, "");
    const national = config.convert_local_leading_zero && digits.startsWith("0") ? digits.slice(1) : digits;
    if (!config.local_digit_lengths.includes(national.length)) return null;
    return `${countryCode} ${national}`;
  };
  const normalized = phone.split("/").map(normalizeOne);
  return normalized.every(Boolean) ? normalized.join("/") : null;
}

/**
 * Keep the complete plate supplied by the fleet. Thai letters and a province
 * are part of a Thai plate, not decoration: removing them can turn a correct
 * vehicle reference into a different one. This function only makes spacing
 * consistent; it never translates, guesses, or removes a script.
 */
export function normalizeLicensePlateForReturn(plate: string | null | undefined) {
  if (!plate) return null;
  const normalized = plate.trim().replace(/\s+/g, " ").replace(/\s*-\s*/g, "-");
  return normalized || null;
}

/** Formats an international passenger phone as "+country code national number" using YAML rules.
 * The original value is returned when its country code cannot be identified safely. */
export function formatInternationalPhone(phone: string | null | undefined, rules: RulesConfig = loadRules()) {
  if (!phone) return null;
  const original = phone.trim();
  // When the source explicitly separates a short calling prefix (for example
  // "+97 123456"), preserve it instead of guessing a longer code such as +971.
  if (/^\+\d{1,3}[\s-]/.test(original)) return original;
  let digits = original.replace(/[^\d]/g, "");
  if (original.replace(/[^\d+]/g, "").startsWith("00")) digits = digits.slice(2);
  const countryCode = [...rules.transforms.phone.display.country_calling_codes]
    .sort((left, right) => right.length - left.length)
    .find((code) => digits.startsWith(code.slice(1)));
  if (!countryCode) return original;
  const nationalNumber = digits.slice(countryCode.length - 1);
  return nationalNumber ? `${countryCode}${rules.transforms.phone.display.separator}${nationalNumber}` : countryCode;
}

/** Uses the business rule for orders whose source does not state a luggage count. */
export function defaultLuggageCount(luggage: number | null | undefined, adults: number, children: number, rules: RulesConfig = loadRules()) {
  const statedCount = Number(luggage ?? 0);
  if (statedCount > 0 || !rules.transforms.luggage.default_to_passenger_count_when_unspecified) return statedCount;
  return Math.max(0, Number(adults) || 0) + Math.max(0, Number(children) || 0);
}

/** Turns a stored meet-and-greet request into the fleet-facing wording from YAML. */
export function formatMeetGreetLine(value: string | null | undefined, passengerName: string, rules: RulesConfig = loadRules()) {
  const request = value?.trim();
  if (!request) return "";
  const greetingSignName = request.replace(/^(?:meeting tablet|greeting sign|meeting sign)\s*:\s*/i, "").trim();
  const normalized = greetingSignName.toLocaleLowerCase().replace(/\s+/g, " ");
  const passengers = passengerName
    .split(/\s*,\s*/)
    .map((name) => name.trim().toLocaleLowerCase().replace(/\s+/g, " "))
    .filter(Boolean);
  if (["yes", "true", "required", "meet&greet", "meet & greet", "举牌", "需要举牌"].includes(normalized) || passengers.includes(normalized)) {
    return rules.templates.dispatch.meet_greet.standard_line;
  }
  return renderTemplate(rules.templates.dispatch.meet_greet.greeting_sign_line, { greeting_sign_name: greetingSignName });
}

function vehicleKey(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

export type VehicleModelResolution = {
  value: string | null;
  needsManualReview: boolean;
  reviewReason?: string;
};

/**
 * Combines only evidence the source already supplied. The vehicle catalogue
 * may standardize a known complete brand/model pair, but is never a whitelist
 * and must not invent a missing brand for an otherwise model-only value.
 */
export function resolveVehicleModel(
  vehicle: string | null | undefined,
  recognizedBrand?: string | null,
  rules: RulesConfig = loadRules(),
): VehicleModelResolution {
  if (!vehicle?.trim()) return { value: null, needsManualReview: false };

  const model = vehicle.trim().replace(/\s+/g, " ");
  const brand = recognizedBrand?.trim().replace(/\s+/g, " ") || null;
  const modelKey = vehicleKey(model);
  const brandKey = brand ? vehicleKey(brand) : "";
  const candidates = rules.transforms.vehicle_models.filter((entry) =>
    [entry.canonical_name, ...entry.model_aliases, ...(entry.aliases ?? [])]
      .map(vehicleKey)
      .includes(modelKey),
  );
  const brandMatches = (entry: RulesConfig["transforms"]["vehicle_models"][number]) =>
    [entry.brand, ...(entry.brand_aliases ?? [])].map(vehicleKey).includes(brandKey);
  const modelBrand = candidates.length === 1 ? candidates[0] : null;

  if (brand && modelBrand && !brandMatches(modelBrand)) {
    return { value: model, needsManualReview: true, reviewReason: "AI 识别的品牌与车型信息冲突，请人工确认" };
  }

  if (brand) {
    const matchingCandidate = candidates.filter(brandMatches);
    if (matchingCandidate.length === 1) {
      return { value: matchingCandidate[0].canonical_name, needsManualReview: false };
    }
    // The model already contains the AI-supplied brand (for example “BYD
    // Sealion 7”), so preserve it rather than duplicating the prefix.
    if (modelKey.includes(brandKey)) return { value: model, needsManualReview: false };
    // A new model outside the catalogue is still valid when the same AI result
    // explicitly supplied both fields. Do not make catalogue membership a gate.
    return { value: `${brand} ${model}`, needsManualReview: false };
  }

  // A complete known name can receive harmless capitalization normalization;
  // a model-only value remains exactly as received and needs operator review.
  if (modelBrand && vehicleKey(modelBrand.canonical_name) === modelKey) {
    return { value: modelBrand.canonical_name, needsManualReview: false };
  }
  return { value: model, needsManualReview: true, reviewReason: "AI 只识别到车型，缺少可确认的品牌，请人工确认" };
}

/** Kept for callers that only need a display/save string, never an inferred brand. */
export function normalizeVehicleModel(vehicle: string | null | undefined, rules: RulesConfig = loadRules(), recognizedBrand?: string | null) {
  return resolveVehicleModel(vehicle, recognizedBrand, rules).value;
}

export function formatServiceDateLabel(serviceDate: string, locale: "zh" | "en" = "zh") {
  const date = new Date(`${serviceDate}T12:00:00+07:00`);
  if (Number.isNaN(date.valueOf())) return serviceDate;
  if (locale === "en") return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }).format(date);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Bangkok" }).format(date);
}

export function renderDispatchBatchFooter(city: string, orderCount: number, rules: RulesConfig = loadRules()) {
  const template = rules.templates.dispatch_batch_footers[city];
  if (!template) throw new Error(`No dispatch batch footer configured for city: ${city}`);
  return renderTemplate(template, { order_count: orderCount, order_unit: orderCount === 1 ? "order" : "orders" });
}
