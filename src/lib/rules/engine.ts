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
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("+")) {
    const countryDigits = config.country_code.replace("+", "");
    return digits.startsWith(config.country_code) ? `${config.country_code}${digits.slice(config.country_code.length).replace(/\D/g, "")}` : digits;
  }
  digits = digits.replace(/\D/g, "");
  if (config.convert_local_leading_zero && digits.startsWith("0")) digits = digits.slice(1);
  if (!config.local_digit_lengths.includes(digits.length)) return null;
  return `${config.country_code}${digits}`;
}

/** Formats an international passenger phone as "+country code national number" using YAML rules.
 * The original value is returned when its country code cannot be identified safely. */
export function formatInternationalPhone(phone: string | null | undefined, rules: RulesConfig = loadRules()) {
  if (!phone) return null;
  const original = phone.trim();
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

export function normalizeVehicleModel(vehicle: string | null | undefined, rules: RulesConfig = loadRules()) {
  if (!vehicle) return null;
  const normalizedKey = vehicle.trim().toLocaleLowerCase();
  return rules.transforms.vehicle_aliases[normalizedKey] ?? vehicle.trim();
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
  return renderTemplate(template, { order_count: orderCount });
}
