import { failure, success } from "@/lib/api-response";
import { renderDispatchBatchFooter, renderTemplate } from "@/lib/rules/engine";
import { formatServiceDateLabel } from "@/lib/rules/engine";
import { parseRules } from "@/lib/rules/load-rules";
import { NextRequest } from "next/server";

const example = { platform_order_number: "943 357", passenger_name: "Tarasova Natalia", passenger_phone: "+7 916 555 1234", flight_number: "TG 641", pickup_datetime: "2026-07-25 09:30", pickup_date: "2026-07-25", pickup_time: "09:30", pickup_address: "Suvarnabhumi Airport (BKK), Gate 3", dropoff_address: "Sukhumvit 24, Bangkok", platform_vehicle_type: "MINIBUS", seat_count: 8, adults: 4, children: 1, luggage: 5, child_seat_line: "Child seats required: booster (3+ years old) — 1 pcs", meet_greet_line: "Meet & Greet required", other_notes: "" };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.source !== "string") return failure("INVALID_REQUEST", "请提供规则内容。", undefined, 422);
  try {
    const rules = parseRules(body.source);
    const dispatch = [renderTemplate(rules.templates.dispatch.header, { ...example, service_date_label: formatServiceDateLabel(example.pickup_date) }), renderTemplate(rules.templates.dispatch.body, example), renderDispatchBatchFooter("曼谷", 1, rules)].join("\n\n");
    const iway = [renderTemplate(rules.templates.iway_return.header, { service_date_label_en: formatServiceDateLabel(example.pickup_date, "en") }), renderTemplate(rules.templates.iway_return.body, { ...example, confirmed_vehicle_model: "Toyota Commuter", confirmed_driver_name: "Somchai", normalized_driver_phone: "+66812345678", license_plate: "1กข 2345" }), rules.templates.iway_return.footer].join("\n\n");
    return success({ version: rules.rules_version, dispatch, iway });
  } catch (error) { return failure("RULE_INVALID", error instanceof Error ? error.message : "规则格式无效。", undefined, 422); }
}
