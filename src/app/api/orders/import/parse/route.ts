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

function platformVehicleLabel(vehicleClass: string) {
  const category = vehicleClass.replace(/\s+/g, " ").split("(")[0].trim();
  // Model cars 是可用示例车，不能替代平台要求的车型等级。
  if (/^C$/i.test(category)) return "COMFORT";
  return category;
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
    platformVehicleType: platformVehicleLabel(pick(text, "Vehicle class")),
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

type ParsedFields = ReturnType<typeof parseStandardOrder>;

function compactOrderStarts(text: string) {
  return [...text.matchAll(/^\s*\d{1,2}(?:[\s\u00a0]+\d{3}){2}\s*$/gm)].map((match) => match.index ?? 0);
}

function compactDateTime(value: string) {
  const match = value.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\s+(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}T${match[4].padStart(2, "0")}:${match[5]}`;
}

// esforty 的列表复制格式没有字段标签：一笔订单由“分组订单号”开头，
// 后面依次是电话、乘客、日期时间、平台车型、接人点、航班、送人点。
function parseCompactEsfortyOrder(block: string): ParsedFields | null {
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const orderIndex = lines.findIndex((line) => /^\d{1,2}(?:[\s\u00a0]+\d{3}){2}$/.test(line));
  if (orderIndex < 0) return null;
  const orderNo = normaliseOrderNumber(lines[orderIndex]);
  const timeIndex = lines.findIndex((line) => /\d{1,2}[./-]\d{1,2}[./-]20\d{2}\s+\d{1,2}:\d{2}/.test(line));
  if (!orderNo || timeIndex < 0) return null;

  const beforeTime = lines.slice(orderIndex + 1, timeIndex);
  const phones = [...new Set(beforeTime.filter((line) => /^\+?\d[\d\s()\-]{6,}$/.test(line)).map((line) => line.replace(/\s+/g, " ").trim()))];
  const passengerLine = beforeTime.find((line) => !/^\+?\d[\d\s()\-]{6,}$/.test(line)) || "";
  const passengerName = passengerLine.replace(/\s*\(\s*\d+\s*pax\s*\)\s*$/i, "").trim();
  const adults = Number(passengerLine.match(/\(\s*(\d+)\s*pax\s*\)/i)?.[1] || 0);

  const afterTime = lines.slice(timeIndex + 1);
  const vehicleIndex = afterTime.findIndex((line) => /^(?:economy|standard|comfort|business|premium|suv|minivan|minibus)$/i.test(line));
  const vehicleType = vehicleIndex >= 0 ? afterTime[vehicleIndex] : "";
  const afterVehicle = vehicleIndex >= 0 ? afterTime.slice(vehicleIndex + 1) : afterTime;
  const flightIndex = afterVehicle.findIndex((line) => /^flight\s*(?:number)?\s*:/i.test(line));
  const meetIndex = afterVehicle.findIndex((line) => /meet\s*&?\s*greet/i.test(line));
  const pickupAddress = (flightIndex >= 0 ? afterVehicle.slice(0, flightIndex) : afterVehicle.slice(0, 1)).join(" ").trim();
  const flightNumber = flightIndex >= 0 ? afterVehicle[flightIndex].replace(/^flight\s*(?:number)?\s*:\s*/i, "").trim() : "";
  const dropoffStart = flightIndex >= 0 ? flightIndex + 1 : 1;
  const dropoffEnd = meetIndex >= 0 ? meetIndex : afterVehicle.length;
  const dropoffAddress = afterVehicle.slice(dropoffStart, dropoffEnd).join(" ").trim();
  const cityDetection = detectDispatchCity(pickupAddress, dropoffAddress);

  return {
    platformOrderNumber: orderNo,
    passengerName,
    passengerPhone: phones.join(" / "),
    pickupDateTime: compactDateTime(lines[timeIndex]),
    pickupAddress,
    dropoffAddress,
    platformVehicleType: vehicleType,
    flightNumber,
    adults,
    children: 0,
    luggage: adults,
    meetGreetLine: meetIndex >= 0 ? afterVehicle[meetIndex] : "",
    city: cityDetection.city ?? "",
    cityDetection,
    otherNotes: "",
  };
}

function parseCompactEsfortyList(text: string) {
  const starts = compactOrderStarts(text);
  if (!starts.length) return [];
  return starts.map((start, index) => parseCompactEsfortyOrder(text.slice(start, starts[index + 1]))).filter((item): item is ParsedFields => item !== null);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.text !== "string" || !body.text.trim()) return failure("EMPTY_SOURCE", "请粘贴订单原文。", undefined, 422);
  const text = body.text.trim();
  const isIwayRide = /Ride number\s*[:：]/i.test(text) && /Vehicle class\s*[:：]/i.test(text) && /Itinerary\s*[:：]/i.test(text) && /Clients\s*[:：]/i.test(text);
  const isStandardOrder = /(?:Order Number|Order ID)\s*[:：]/i.test(text) && /Passenger Name\s*[:：]/i.test(text);
  const compactOrders = parseCompactEsfortyList(text);
  const isCompactEsforty = compactOrders.length > 0;
  const sourceType = body.sourceType;
  if (sourceType === "iway_feishu" && !isIwayRide) return failure("SOURCE_MISMATCH", "这段内容不符合 i’way New ride 邮件格式，已阻止导入。", undefined, 422);
  if (sourceType === "esforty" && !isStandardOrder && !isCompactEsforty) return failure("SOURCE_MISMATCH", "这段内容不符合 esforty/标准订单格式，已阻止导入。", undefined, 422);
  if (sourceType === "manual" && body.confirmedSource !== true) return failure("SOURCE_UNCONFIRMED", "手工录入前必须确认订单来源。", undefined, 422);
  if (!["iway_feishu", "esforty", "manual"].includes(sourceType)) return failure("SOURCE_REQUIRED", "请选择订单来源后再识别。", undefined, 422);
  if (!isIwayRide && !isStandardOrder && !isCompactEsforty) return failure("NOT_AN_ORDER", "未识别到订单格式。可粘贴 i’way 邮件、带字段标签的订单，或 esforty 紧凑列表。", undefined, 422);

  const parsedOrders = isCompactEsforty ? compactOrders : [isIwayRide ? parseIwayRide(text) : parseStandardOrder(text)];
  const required = ["platformOrderNumber", "passengerName", "passengerPhone", "pickupDateTime", "pickupAddress", "dropoffAddress", "platformVehicleType", "city"] as const;
  const orders = await Promise.all(parsedOrders.map(async (parsed) => {
    const { cityDetection, ...fields } = parsed;
    const missingFields = required.filter((key) => !fields[key]);
    const exact = fields.platformOrderNumber ? await db.order.findMany({ where: { platformOrderNumber: fields.platformOrderNumber }, select: { id: true, platformOrderNumber: true } }) : [];
    const suspected = fields.passengerName ? await db.order.findMany({ where: { passengerName: fields.passengerName }, select: { id: true, platformOrderNumber: true } }) : [];
    return { fields, cityDetection, missingFields, duplicates: { exact: exact.map((order) => ({ id: order.id, orderNo: order.platformOrderNumber })), suspected: suspected.filter((order) => !exact.some((item) => item.id === order.id)).map((order) => ({ id: order.id, orderNo: order.platformOrderNumber, reason: "乘客姓名相同，请人工核对服务时间和路线" })) } };
  }));
  const first = orders[0];
  const [thaiTranslation, vehicleImage] = await Promise.all([translateThaiForReview(text), identifyVehicleFromImage(typeof body.vehicleImageUrl === "string" ? body.vehicleImageUrl : "")]);
  return success({ ...first, orders, fields: first.fields, rawText: text, source: { type: sourceType, format: isCompactEsforty ? "esforty_compact_list" : isIwayRide ? "iway_new_ride" : "standard_order", verified: sourceType !== "manual" || body.confirmedSource === true }, status: first.missingFields.length ? "PENDING_REVIEW" : "READY_TO_DISPATCH", duplicates: first.duplicates, assistance: { thaiTranslation, vehicleImage } });
}
