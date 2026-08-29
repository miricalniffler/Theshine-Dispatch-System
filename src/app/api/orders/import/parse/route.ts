import { failure, success } from "@/lib/api-response";
import { identifyVehicleFromImage, translateThaiForReview } from "@/features/assist/service";
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { detectDispatchCity } from "@/lib/city/detect-city";

function pick(text: string, label: string) {
  return text.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1]?.trim() || "";
}

function normaliseOrderNumber(value: string) {
  return value.replace(/^#/, "").replace(/\s/g, "");
}

function numberFrom(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function lastPassengerName(value: string) {
  const names = value
    .split(/\s*(?:,|;|\/|\n|\s+&\s+|\s+and\s+)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.at(-1) || "";
}

function passengerCounts(text: string) {
  const children = numberFrom(pick(text, "Children"));
  const statedAdults = pick(text, "Adults");
  const totalPassengers = numberFrom(pick(text, "Number of passengers"));
  const adults = statedAdults ? numberFrom(statedAdults) : Math.max(0, totalPassengers - children);
  return { adults, children };
}

function luggageFor(text: string, passengerCount: number) {
  const stated = pick(text, "(?:Luggage|Number of luggage|Baggage)");
  return stated ? numberFrom(stated) : passengerCount;
}

function meetGreetFor(text: string) {
  const signName = pick(text, "(?:Meeting tablet|Greeting sign|Meeting sign|Meet(?:ing)?&?Greet)");
  return signName || (/meet\s*&?\s*greet|举牌/i.test(text) ? "Meet&Greet" : "");
}

function platformVehicleLabel(vehicleClass: string, modelCars: string) {
  const category = vehicleClass.replace(/\s+/g, " ").split("(")[0].trim();
  // C、E 等是 i'way 邮件里的内部车型分类码，不应直接展示给运营人员。
  // 有明确 Model cars 时显示该车型；否则标为待核对，避免把 C 当作车型。
  if (!/^[A-Z]\d?$/i.test(category)) return category;
  const model = modelCars.replace(/\s+/g, " ").split(/,\s*\d+\.\s*/)[0]
    .replace(/^\d+\.\s*/, "")
    .replace(/\(\s*(?:\d+\s*)?(?:seats?|pax)\s*[-:]\s*\d+\s*\)/gi, "")
    .replace(/\(?\s*\d+\s*(?:seats?|pax)\s*[-:]\s*\d+\s*\)?/gi, "")
    .replace(/\s*(?:,|;|-)?\s*(?:seats?|pax)\b.*$/i, "")
    .replace(/[\s,;:-]+$/, "")
    .trim();
  return model || "待核对";
}

function parseIwayRide(text: string) {
  const rideNumber = pick(text, "Ride number");
  const date = pick(text, "Date");
  const time = pick(text, "Time");
  const flightDeparture = pick(text, "Departure time");
  const year = flightDeparture.match(/(20\d{2})/)?.[1] || String(new Date().getFullYear());
  const dateParts = date.match(/(\d{1,2})[./-](\d{1,2})/);
  const serviceDate = dateParts ? `${year}-${dateParts[2].padStart(2, "0")}-${dateParts[1].padStart(2, "0")}` : "";
  const itinerary = text.match(/Itinerary\s*:\s*([\s\S]*?)(?=Flight number\/train number\s*:|Departure time\s*:|Remarks\s*:)/i)?.[1] || "";
  const pickupAddress = itinerary.match(/From\s*:\s*([\s\S]*?)(?=\n\s*To\s*:)/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
  const dropoffAddress = itinerary.match(/To\s*:\s*([^\n]+)/i)?.[1]?.trim() || "";
  const clients = pick(text, "Clients");
  const passengerPhone = clients.match(/phone\s+([+\d][\d\s-]+)/i)?.[1]?.trim() || "";
  const passengerName = lastPassengerName(clients.replace(/,?\s*phone\s+[+\d][\d\s-]+.*$/i, "").trim());
  const { adults, children } = passengerCounts(text);
  const cityDetection = detectDispatchCity(pickupAddress, dropoffAddress);
  return {
    platformOrderNumber: normaliseOrderNumber(rideNumber),
    passengerName,
    passengerPhone,
    pickupDateTime: serviceDate && time ? `${serviceDate}T${time.slice(0, 5)}` : "",
    pickupAddress,
    dropoffAddress,
    platformVehicleType: platformVehicleLabel(pick(text, "Vehicle class"), pick(text, "Model cars")),
    flightNumber: pick(text, "Flight number/train number"),
    adults,
    children,
    luggage: luggageFor(text, adults + children),
    meetGreetLine: meetGreetFor(text),
    city: cityDetection.city ?? "",
    cityDetection,
    otherNotes: [flightDeparture && `Flight departure: ${flightDeparture}`, pick(text, "Meeting tablet") && `Meeting tablet: ${pick(text, "Meeting tablet")}`, pick(text, "Remarks")].filter(Boolean).join("\n"),
  };
}

function parseStandardOrder(text: string) {
  const { adults, children } = passengerCounts(text);
  const pickupAddress = pick(text, "Pickup address");
  const dropoffAddress = pick(text, "Dropoff address");
  const cityDetection = detectDispatchCity(pickupAddress, dropoffAddress);
  return {
    platformOrderNumber: normaliseOrderNumber(pick(text, "(?:Order Number|Order ID)")),
    passengerName: pick(text, "Passenger Name"),
    passengerPhone: pick(text, "(?:Passenger Phone Number|Phone)"),
    pickupDateTime: pick(text, "(?:Departure Time|Pickup Time)"),
    pickupAddress,
    dropoffAddress,
    platformVehicleType: pick(text, "Vehicle Type"),
    flightNumber: pick(text, "Flight Number"),
    adults,
    children,
    luggage: luggageFor(text, adults + children),
    meetGreetLine: meetGreetFor(text),
    city: cityDetection.city ?? "",
    cityDetection,
    otherNotes: "",
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.text !== "string" || !body.text.trim()) return failure("EMPTY_SOURCE", "请粘贴订单原文。", undefined, 422);
  const text = body.text.trim();
  const isIwayRide = /Ride number\s*[:：]/i.test(text) && /Vehicle class\s*[:：]/i.test(text) && /Itinerary\s*[:：]/i.test(text) && /Clients\s*[:：]/i.test(text);
  const isStandardOrder = /(?:Order Number|Order ID)\s*[:：]/i.test(text) && /Passenger Name\s*[:：]/i.test(text);
  const sourceType = body.sourceType;
  if (sourceType === "iway_feishu" && !isIwayRide) return failure("SOURCE_MISMATCH", "这段内容不符合 i’way New ride 邮件格式，已阻止导入。", undefined, 422);
  if (sourceType === "esforty" && !isStandardOrder) return failure("SOURCE_MISMATCH", "这段内容不符合 esforty/标准订单格式，已阻止导入。", undefined, 422);
  if (sourceType === "manual" && body.confirmedSource !== true) return failure("SOURCE_UNCONFIRMED", "手工录入前必须确认订单来源。", undefined, 422);
  if (!["iway_feishu", "esforty", "manual"].includes(sourceType)) return failure("SOURCE_REQUIRED", "请选择订单来源后再识别。", undefined, 422);
  if (!isIwayRide && !isStandardOrder) return failure("NOT_AN_ORDER", "未识别到完整的新订单结构；车队回复不会被当作订单导入。", undefined, 422);

  const parsed = isIwayRide ? parseIwayRide(text) : parseStandardOrder(text);
  const { cityDetection, ...fields } = parsed;
  const required = ["platformOrderNumber", "passengerName", "passengerPhone", "pickupDateTime", "pickupAddress", "dropoffAddress", "platformVehicleType", "city"] as const;
  const missingFields = required.filter((key) => !fields[key]);
  const exact = fields.platformOrderNumber ? await db.order.findMany({ where: { platformOrderNumber: fields.platformOrderNumber }, select: { id: true, platformOrderNumber: true } }) : [];
  const suspected = fields.passengerName ? await db.order.findMany({ where: { passengerName: fields.passengerName }, select: { id: true, platformOrderNumber: true } }) : [];
  const [thaiTranslation, vehicleImage] = await Promise.all([translateThaiForReview(text), identifyVehicleFromImage(typeof body.vehicleImageUrl === "string" ? body.vehicleImageUrl : "")]);
  return success({ fields, cityDetection, missingFields, rawText: text, source: { type: sourceType, format: isIwayRide ? "iway_new_ride" : "standard_order", verified: sourceType !== "manual" || body.confirmedSource === true }, status: missingFields.length ? "PENDING_REVIEW" : "READY_TO_DISPATCH", duplicates: { exact: exact.map((order) => ({ id: order.id, orderNo: order.platformOrderNumber })), suspected: suspected.filter((order) => !exact.some((item) => item.id === order.id)).map((order) => ({ id: order.id, orderNo: order.platformOrderNumber, reason: "乘客姓名相同，请人工核对服务时间和路线" })) }, assistance: { thaiTranslation, vehicleImage } });
}
