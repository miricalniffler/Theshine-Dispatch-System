import { failure, success } from "@/lib/api-response";
import { identifyVehicleFromImage, translateThaiForReview } from "@/features/assist/service";
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { detectDispatchCity } from "@/lib/city/detect-city";
import { isIwayNewRideEmail, parseIwayNewRide } from "@/features/import/iway-new-ride-parser";
import { detectServiceTimeZone } from "@/features/import/service-timezone";

function pick(text: string, label: string) {
  return text.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1]?.trim() || "";
}

// iWay 邮件偶尔会把底部的说明文字接在同一行字段之后。导入时只保留
// 第一个像电话号码的片段，避免把邮件正文误当成乘客电话。
function phoneFrom(value: string) {
  const normalised = value.replace(/[–—]/g, "-");
  const match = normalised.match(/(?:\+?\d[\d\s()\-]{5,}\d)/);
  return match?.[0]?.replace(/\s+/g, " ").trim() || "";
}

// 以下是 iWay 邮件中地址字段之后出现的辅助字段，不属于送达地点。
function addressFrom(value: string) {
  return value
    .replace(/\s+(?:rent\s+a\s+vehicle|intercity|waiting\s+time|child\s+seat|extra\s+services?)\s*:[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseOrderNumber(value: string) {
  return value.replace(/^\s*(?:ride|order(?:\s*(?:number|no\.?|id))?)?\s*[:#№-]*\s*/i, "").replace(/\s/g, "");
}

function numberFrom(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 0;
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

function parseStandardOrder(text: string) {
  const { adults, children } = passengerCounts(text);
  const pickupAddress = addressFrom(pick(text, "Pickup address"));
  const dropoffAddress = addressFrom(pick(text, "Dropoff address"));
  const cityDetection = detectDispatchCity(pickupAddress, dropoffAddress);
  const timeZoneDetection = detectServiceTimeZone(pickupAddress, dropoffAddress);
  return {
    platformOrderNumber: normaliseOrderNumber(pick(text, "(?:Order Number|Order ID)")),
    passengerName: pick(text, "Passenger Name"),
    passengerPhone: phoneFrom(pick(text, "(?:Passenger Phone Number|Phone)")),
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
    serviceTimeZone: timeZoneDetection.timeZone ?? "",
    timeZoneDetection,
    otherNotes: "",
  };
}

/**
 * A number of iWay messages are copied from WhatsApp or Telegram rather than
 * from the email template.  They keep labels, but not the "Ride number" /
 * "Itinerary" headings used by parseIwayRide.  This parser deliberately only
 * reads values that are present in the message: absent fields remain empty and
 * are sent to the review screen as pending rather than guessed.
 */
export function parseIwayLabelledOrder(text: string) {
  const { adults: labelledAdults, children } = passengerCounts(text);
  const passengerLine = pick(text, "(?:Passenger|Client|Clients|Guest)(?:\\s+name)?");
  const passengerPhone = phoneFrom(pick(text, "(?:Passenger\\s+Phone\\s+Number|Passenger\\s+Phone|Phone|Mobile|Tel(?:ephone)?)"))
    || phoneFrom(passengerLine)
    || "";
  const passengerName = passengerLine
    .replace(/(?:\+?\d[\d\s()\-]{6,})/g, "")
    .replace(/\s*\(\s*\d+\s*pax\s*\)\s*/i, " ")
    .trim();
  const pickupAddress = addressFrom(pick(text, "(?:From|Pickup(?:\\s+(?:address|point|location))?|Pick\\s*up)"));
  const dropoffAddress = addressFrom(pick(text, "(?:To|Dropoff|Drop\\s*off|Destination)(?:\\s+(?:address|point|location))?"));
  const rawDateTime = pick(text, "(?:Pickup\\s*)?(?:Date(?:\\s*(?:/|and)\\s*Time)?|Date\\s*&\\s*Time|Pickup\\s+time|Time)");
  const pickupDateTime = compactDateTime(rawDateTime) || rawDateTime;
  const pax = Number(passengerLine.match(/\(\s*(\d+)\s*pax\s*\)/i)?.[1] || 0);
  const adults = labelledAdults || pax;
  const cityDetection = detectDispatchCity(pickupAddress, dropoffAddress);
  const timeZoneDetection = detectServiceTimeZone(pickupAddress, dropoffAddress);
  return {
    platformOrderNumber: normaliseOrderNumber(pick(text, "(?:Ride\s*)?(?:Order\s*)?(?:number|no\\.?|id)")),
    passengerName,
    passengerPhone,
    pickupDateTime,
    pickupAddress,
    dropoffAddress,
    platformVehicleType: pick(text, "(?:Vehicle(?:\\s+(?:class|type))?|Car(?:\\s+type)?)"),
    flightNumber: pick(text, "(?:Flight(?:\\s+number)?|Train(?:\\s+number)?)"),
    adults,
    children,
    luggage: luggageFor(text, adults + children),
    meetGreetLine: meetGreetFor(text),
    city: cityDetection.city ?? "",
    cityDetection,
    serviceTimeZone: timeZoneDetection.timeZone ?? "",
    timeZoneDetection,
    otherNotes: pick(text, "(?:Remarks|Notes?|Special\\s+requests?)"),
  };
}

type ParsedFields = ReturnType<typeof parseStandardOrder>;

function compactOrderStarts(text: string) {
  // iWay commonly uses `949 810`; esforty also emits 7-digit values such as
  // `1 015 534`. Keep both shapes as separate order blocks.
  return [...text.matchAll(/^\s*(?:(?:ride|order(?:\s*(?:number|no\.?|id))?)\s*[:#№-]*\s*)?(?:\d{3}[\s\u00a0]+\d{3,4}|\d{1,2}(?:[\s\u00a0]+\d{3}){2})\s*$/gim)].map((match) => match.index ?? 0);
}

function compactDateTime(value: string) {
  const match = value.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\s+(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}T${match[4].padStart(2, "0")}:${match[5]}`;
}

// esforty 的列表复制格式没有字段标签：一笔订单由“分组订单号”开头，
// 后面依次是电话、乘客、日期时间、平台车型、接人点、航班、送人点。
export function parseCompactIwayOrEsfortyOrder(block: string): ParsedFields | null {
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const orderIndex = lines.findIndex((line) => /^(?:(?:ride|order(?:\s*(?:number|no\.?|id))?)\s*[:#№-]*\s*)?(?:\d{3}[\s\u00a0]+\d{3,4}|\d{1,2}(?:[\s\u00a0]+\d{3}){2})$/i.test(line));
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
  const vehicleIndex = afterTime.findIndex((line) => /^(?:economy|standard|comfort|business(?:\s+class)?|premium|suv|minivan|minibus|van|sedan)(?:\s*\([^)]*\)|\s+\d+\s*(?:pax|seats?))?$/i.test(line));
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
  const timeZoneDetection = detectServiceTimeZone(pickupAddress, dropoffAddress);

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
    serviceTimeZone: timeZoneDetection.timeZone ?? "",
    timeZoneDetection,
    otherNotes: "",
  };
}

function parseCompactEsfortyList(text: string) {
  const starts = compactOrderStarts(text);
  if (!starts.length) return [];
  return starts.map((start, index) => parseCompactIwayOrEsfortyOrder(text.slice(start, starts[index + 1]))).filter((item): item is ParsedFields => item !== null);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.text !== "string" || !body.text.trim()) return failure("EMPTY_SOURCE", "请粘贴订单原文。", undefined, 422);
  const text = body.text.trim();
  const isIwayRide = isIwayNewRideEmail(text);
  const isStandardOrder = /(?:Order Number|Order ID)\s*[:：]/i.test(text) && /Passenger Name\s*[:：]/i.test(text);
  const isIwayLabelled = /(?:ride\s*)?(?:order\s*)?(?:number|no\.?|id)\s*[:#№-]/i.test(text)
    && /(?:pickup\s*)?(?:date|time)\s*[:：]/i.test(text)
    && /(?:from|pickup(?:\s+(?:address|point|location))?)\s*[:：]/i.test(text)
    && /(?:to|dropoff|destination)(?:\s+(?:address|point|location))?\s*[:：]/i.test(text);
  const compactOrders = parseCompactEsfortyList(text);
  const isCompactEsforty = compactOrders.length > 0;
  const sourceType = body.sourceType;
  if (sourceType === "iway_feishu" && !isIwayRide && !isIwayLabelled && !isCompactEsforty) return failure("SOURCE_MISMATCH", "这段内容不符合 i’way 订单格式，已阻止导入。", undefined, 422);
  if (sourceType === "esforty" && !isStandardOrder && !isCompactEsforty) return failure("SOURCE_MISMATCH", "这段内容不符合 esforty/标准订单格式，已阻止导入。", undefined, 422);
  if (sourceType === "manual" && body.confirmedSource !== true) return failure("SOURCE_UNCONFIRMED", "手工录入前必须确认订单来源。", undefined, 422);
  if (!["iway_feishu", "esforty", "manual"].includes(sourceType)) return failure("SOURCE_REQUIRED", "请选择订单来源后再识别。", undefined, 422);
  if (!isIwayRide && !isIwayLabelled && !isStandardOrder && !isCompactEsforty) return failure("NOT_AN_ORDER", "未识别到订单格式。可粘贴 i’way 邮件、WhatsApp/Telegram 标签订单、带字段标签的订单，或 esforty 紧凑列表。", undefined, 422);

  const parsedOrders = isCompactEsforty ? compactOrders : [isIwayRide ? parseIwayNewRide(text) : isIwayLabelled ? parseIwayLabelledOrder(text) : parseStandardOrder(text)];
  const required = ["platformOrderNumber", "passengerName", "passengerPhone", "pickupDateTime", "pickupAddress", "dropoffAddress", "platformVehicleType", "city"] as const;
  const orders = await Promise.all(parsedOrders.map(async (parsed) => {
    // Time-zone evidence is used by the cloud mail importer. It is not an
    // editable order field in the manual-review form, where service city
    // remains the operator-facing routing decision.
    const { cityDetection, serviceTimeZone: _serviceTimeZone, timeZoneDetection: _timeZoneDetection, ...fields } = parsed;
    const missingFields = required.filter((key) => !fields[key]);
    const exact = fields.platformOrderNumber ? await db.order.findMany({ where: { platformOrderNumber: fields.platformOrderNumber }, select: { id: true, platformOrderNumber: true } }) : [];
    const suspected = fields.passengerName ? await db.order.findMany({ where: { passengerName: fields.passengerName }, select: { id: true, platformOrderNumber: true } }) : [];
    return { fields, cityDetection, missingFields, duplicates: { exact: exact.map((order) => ({ id: order.id, orderNo: order.platformOrderNumber })), suspected: suspected.filter((order) => !exact.some((item) => item.id === order.id)).map((order) => ({ id: order.id, orderNo: order.platformOrderNumber, reason: "乘客姓名相同，请人工核对服务时间和路线" })) } };
  }));
  const first = orders[0];
  const [thaiTranslation, vehicleImage] = await Promise.all([translateThaiForReview(text), identifyVehicleFromImage(typeof body.vehicleImageUrl === "string" ? body.vehicleImageUrl : "")]);
  return success({ ...first, orders, fields: first.fields, rawText: text, source: { type: sourceType, format: isCompactEsforty ? "compact_iway_or_esforty" : isIwayRide ? "iway_new_ride" : isIwayLabelled ? "iway_labelled_chat" : "standard_order", verified: sourceType !== "manual" || body.confirmedSource === true }, status: first.missingFields.length ? "PENDING_REVIEW" : "READY_TO_DISPATCH", duplicates: first.duplicates, assistance: { thaiTranslation, vehicleImage } });
}
