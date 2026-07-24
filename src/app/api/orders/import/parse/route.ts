import { failure, success } from "@/lib/api-response";
import { NextRequest } from "next/server";

function pick(text: string, label: string) { return text.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1]?.trim() || ""; }

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.text !== "string" || !body.text.trim()) return failure("EMPTY_SOURCE", "请粘贴订单原文。", undefined, 422);
  const text = body.text;
  const result = { platformOrderNumber: pick(text, "(?:Order Number|Order ID)"), passengerName: pick(text, "Passenger Name"), passengerPhone: pick(text, "(?:Passenger Phone Number|Phone)"), pickupDateTime: pick(text, "(?:Departure Time|Pickup Time)"), pickupAddress: pick(text, "Pickup address"), dropoffAddress: pick(text, "Dropoff address"), platformVehicleType: pick(text, "Vehicle Type"), flightNumber: pick(text, "Flight Number") };
  const missing = Object.entries(result).filter(([key, value]) => !value && key !== "flightNumber").map(([key]) => key);
  return success({ fields: result, missingFields: missing, rawText: text, status: missing.length ? "PENDING_REVIEW" : "READY_TO_DISPATCH" });
}
