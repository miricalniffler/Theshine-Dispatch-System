import { z } from "zod";
import { db } from "@/lib/db";
import { loadRules } from "@/lib/rules/load-rules";
import { normalizeDriverPhone, normalizeLicensePlateForReturn, resolveVehicleModel } from "@/lib/rules/engine";
import { serviceTimeZoneForCity } from "@/lib/city/detect-city";
import { saveDriverDetails } from "@/features/iway/service";
import { isQwenConfigured } from "@/features/assist/qwen";
import { findConfirmedEnglishDriverNames, isAiNameTransliterationEnabled, transliterateThaiDriverNames } from "@/features/assist/service";
import { isAiVisionRealCallsEnabled, recognizeFleetPackage, recognizeFleetReplyText, recognizeFleetScreenshot, recognizeVehicleImage, type FleetPackageVision, type FleetTextVision } from "@/features/assist/vision";

export type CandidateOrder = { id: string; orderNo: string; passengerName: string; pickup: string; route: string; city: string; fleetName: string };
type Field = { value: string | null; evidence: string };
export type ReplyRecord = {
  source_index: number;
  order_match: { platform_order_number: string | null; confidence: "high" | "medium" | "low"; evidence: string };
  driver_name: Field;
  driver_phone: Field;
  license_plate: Field;
  vehicle_category: Field;
  vehicle_brand: Field;
  vehicle_model_raw: Field;
  vehicle_model: Field;
  vehicle_color?: Field;
  image_source_index: number | null;
  needs_review: boolean;
  review_reasons: string[];
};
type Analysis = { records: ReplyRecord[]; unmatched_items: { source_type: "text" | "image"; source_id: string; reason: string }[]; recognition?: { provider: "GLM" | "QWEN" | "RULES"; label: string; note: string } };
type VisualResult = { vehicle_brand: string | null; vehicle_model: string | null; vehicle_category: string | null; license_plate: string | null; confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" };
type FleetProfile = "AUTO" | "BANGKOK" | "SAMUI" | "KUALA_LUMPUR";

function normalizedOrderNo(value: string) { return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase(); }
function normalizePlate(value: string | null) { return (normalizeLicensePlateForReturn(value) ?? "").replace(/[\s-]/g, "").toLowerCase(); }
function parseIds(raw: string | null) { try { return raw ? z.array(z.string()).parse(JSON.parse(raw)) : []; } catch { return []; } }
function bangkokToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function bangkokTomorrow() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function hasThai(value: string | null) { return Boolean(value && /[\u0E00-\u0E7F]/.test(value)); }
function field(value: string | null | undefined, evidence: string): Field { return { value: value?.trim() || null, evidence }; }

function applyRecognizedVehicle(target: ReplyRecord, brand: string | null, model: string | null, evidence: string, confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN") {
  if (brand) target.vehicle_brand = field(brand, evidence);
  if (model) target.vehicle_model_raw = field(model, evidence);
  const resolved = resolveVehicleModel(model, brand, loadRules());
  if (resolved.value) target.vehicle_model = field(resolved.value, evidence);
  if (resolved.needsManualReview && resolved.reviewReason) {
    target.needs_review = true;
    if (!target.review_reasons.includes(resolved.reviewReason)) target.review_reasons.push(resolved.reviewReason);
  }
  if (confidence !== "HIGH") {
    target.needs_review = true;
    const reason = "AI 车型识别置信度不足，请人工确认";
    if (!target.review_reasons.includes(reason)) target.review_reasons.push(reason);
  }
}

async function candidateOrdersFor(reply: { dispatchBatchId: string | null; candidateOrderIds: string | null }) {
  const ids = parseIds(reply.candidateOrderIds);
  const orderIds = ids.length ? ids : reply.dispatchBatchId
    ? (await db.dispatchBatch.findUnique({ where: { id: reply.dispatchBatchId }, include: { orders: true } }))?.orders.map((link) => link.orderId) ?? []
    : [];
  // Completed orders can receive a legitimate driver/vehicle correction.
  // They remain visible to the reply workflow, but cancelled orders never do.
  const where = orderIds.length ? { id: { in: orderIds } } : { serviceDate: bangkokToday(), status: { notIn: ["CANCELLED"] } };
  const orders = await db.order.findMany({ where, include: { fleet: true }, orderBy: { pickupDateTime: "asc" } });
  return orders.map((order): CandidateOrder => ({
    id: order.id, orderNo: order.platformOrderNumber, passengerName: order.passengerName,
    pickup: `${order.serviceDate} ${order.pickupDateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: serviceTimeZoneForCity(order.city) ?? "Asia/Bangkok" })}`,
    route: `${order.pickupAddress} → ${order.dropoffAddress}`, city: order.city, fleetName: order.fleet?.name ?? "未分配车队",
  }));
}

export async function listReplyContexts() {
  const batches = await db.dispatchBatch.findMany({ where: { orders: { some: { order: { status: { in: ["DISPATCHED", "DRIVER_CONFIRMED"] } } } } }, include: { fleet: true, orders: { include: { order: true } } }, orderBy: { createdAt: "desc" }, take: 30 });
  return batches.map((batch) => ({ id: batch.id, city: batch.city, fleetName: batch.fleet.name, serviceDate: batch.serviceDate, orderIds: batch.orders.map((link) => link.orderId), orders: batch.orders.map((link) => ({ id: link.order.id, orderNo: link.order.platformOrderNumber, passengerName: link.order.passengerName })) }));
}

export async function listFleetReplyDates() {
  const today = bangkokToday();
  const rows = await db.order.findMany({ where: { serviceDate: { gte: today }, status: { notIn: ["CANCELLED"] } }, select: { serviceDate: true }, distinct: ["serviceDate"], orderBy: { serviceDate: "asc" } });
  const dates = [...new Set([bangkokTomorrow(), ...rows.map((row) => row.serviceDate)])].sort();
  return { defaultDate: bangkokTomorrow(), dates };
}

export async function createFleetReply(input: { dispatchBatchId?: string; orderIds?: string[]; serviceDate?: string; rawText?: string; fleetProfile?: FleetProfile; images?: { dataUrl: string; filename?: string; mimeType?: string }[] }) {
  const rawText = input.rawText?.trim() ?? "";
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate ?? "") ? input.serviceDate! : bangkokTomorrow();
  const city = input.fleetProfile === "SAMUI" ? "苏梅" : input.fleetProfile === "BANGKOK" ? "曼谷" : input.fleetProfile === "KUALA_LUMPUR" ? "吉隆坡" : undefined;
  const dateOrderIds = input.orderIds?.length ? [] : (await db.order.findMany({ where: { serviceDate: selectedDate, status: { notIn: ["CANCELLED"] }, ...(city ? { city } : {}) }, select: { id: true } })).map((order) => order.id);
  const orderIds = [...new Set([...(input.orderIds ?? []), ...dateOrderIds])];
  if (!rawText && !(input.images?.length)) throw new Error("SOURCE_REQUIRED");
  if ((input.images?.length ?? 0) > 6) throw new Error("IMAGE_PACKAGE_TOO_LARGE");
  if ((input.images ?? []).some((image) => !image.dataUrl.startsWith("data:image/") || image.dataUrl.length > 8_000_000)) throw new Error("IMAGE_INVALID_OR_TOO_LARGE");
  const profile = input.fleetProfile ?? "AUTO";
  const reply = await db.fleetReply.create({ data: { dispatchBatchId: input.dispatchBatchId || null, candidateOrderIds: orderIds.length ? JSON.stringify(orderIds) : null, rawText, createdBy: `运营人员|${profile}`, images: { create: (input.images ?? []).map((image) => ({ storagePath: image.dataUrl, originalFilename: image.filename || null, mimeType: image.mimeType || "image/*" })) } }, include: { images: true } });
  return { id: reply.id, rawText: reply.rawText, imageCount: reply.images.length };
}

const orderHeader = /(?:^|\n)[ \t]*(?:(?:M\d+[ \t]+)?(?:order[ \t]*(?:number|id|no\.?)|ride[ \t]*number|订单(?:编号|号码|号)|订单)[ \t]*[:：#][ \t]*|(?=\d))(\d{1,2}[ \u00a0]+\d{3}[ \u00a0]+\d{3}|\d{3}[ \u00a0]+\d{3,4}|\d{6,8})(?=[ \t]*(?:\r?$|\n|Passenger|Pickup|Driver|司机|电话|车牌|车型))/gim;

export function orderBlocks(text: string) {
  const matches = [...text.matchAll(orderHeader)];
  if (!matches.length) return [text];
  return matches.map((match, index) => text.slice(match.index, matches[index + 1]?.index ?? text.length));
}

function exactBlockOrderNumber(block: string) {
  return [...block.matchAll(orderHeader)][0]?.[1]?.replace(/\s/g, "") ?? null;
}

function firstMatch(text: string, pattern: RegExp) { return text.match(pattern)?.[1]?.trim() ?? null; }

// A Bangkok reply commonly contains the whole dispatched order followed by a
// short driver reply.  Parse only that trailing reply, otherwise labels such
// as “Passenger Name” and “Passenger Phone Number” get mistaken for driver
// details.
function bangkokDriverReplySection(block: string) {
  const anchors = [...block.matchAll(/(?:luggage\s*capacity|meet\s*with\s*greeting\s*sign|meet\s*&?\s*greet)[^\n]*/gi)];
  const last = anchors.at(-1);
  return last?.index === undefined ? block : block.slice(last.index + last[0].length);
}

function readName(block: string) {
  const labelled = firstMatch(block, /(?:driver\s*name|driver|name|司机姓名|司机名字|司机)\s*(?::|：|\.)+\s*([^\n]+)/i);
  if (labelled) return labelled.replace(/^(?:driver\s*name|driver|name)\s*[:：.]?/i, "").trim();
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  const phoneAt = lines.findIndex((line) => /(?:tel|phone|📞|\+?66|0\d{8,})/i.test(line));
  if (phoneAt > 0) {
    for (let index = phoneAt - 1; index >= 0; index -= 1) {
      const candidate = lines[index];
      const isPlate = /^(?:\d{1,2}[ก-๙]{1,3}\s*\d{1,4}|[ก-๙]{1,3}\s*\d{1,4}|\d{3,5})$/i.test(candidate);
      if (!isPlate && !/(order|passenger|pickup|dropoff|flight|vehicle|luggage|address|meet|type|car\s*no)/i.test(candidate) && candidate.length <= 60) return candidate.replace(/^[^\p{L}\p{N}]+/u, "");
    }
  }
  return null;
}

function readPhone(block: string) {
  // A plate is often on the next line after the phone.  Never let a phone
  // match cross a line break, otherwise “062…\n6911” becomes one invalid
  // telephone number.
  const linePhones = block.split("\n").flatMap((line) => {
    const matches = [...line.matchAll(/(?:\+\s*(?:66|60)[\s-]*|0)\d(?:[\d -]*\d)/g)].map((match) => match[0].trim());
    return matches.filter((value) => value.replace(/\D/g, "").length >= 9);
  });
  // If the fleet gave local Thai numbers, they are the reply's intended
  // contacts. Ignore a later +66 number from another pasted reply block.
  const local = linePhones.filter((value) => value.replace(/\D/g, "").startsWith("0"));
  const phones = local.length ? local : linePhones;
  return phones.length ? [...new Set(phones)].join("/") : null;
}

function readPlate(block: string) {
  const labelled = firstMatch(block, /(?:car\s*(?:no|number|plate)|plate|license\s*plate|ทะเบียน|车牌号码|车牌号|车牌)\s*(?::|：|\.)+\s*([^\n]+)/i);
  if (labelled) return labelled;
  const lines = block.split("\n").map((line) => line.trim());
  const value = lines.find((line) => /^(?:\d{3,5}|[ก-๙]{1,3}\s*\d{1,4}|\d{1,2}[ก-๙]{1,3}\s*\d{1,4})$/i.test(line));
  return value?.match(/\d{3,5}/)?.[0] ?? null;
}

function readVehicleModel(block: string, allowInlineModel = true) {
  const labelled = firstMatch(block, /(?:vehicle\s*(?:type|model)?|type|model|van|minibus|sedan|suv|具体车型|车辆型号|车型)\s*(?::|：|\.)+\s*([^\n]+)/i);
  if (labelled && !/^(?:minibus|minivan|van|sedan|standard)$/i.test(labelled)) return labelled;
  return allowInlineModel ? firstMatch(block, /\b((?:toyota|hyundai|honda|isuzu|mitsubishi|mercedes)[^,\n]{0,45})/i) : null;
}

export function sanitizeAiDriverName(value: string | null) {
  const cleaned = value?.replace(/^(?:driver(?:\s*name)?|name|司机姓名|司机名字|司机)\s*(?::|：|\.)+\s*/i, "").trim() || null;
  if (!cleaned || /\b(?:car\s*plate|plate\s*number|license\s*plate|mobile|phone|tel(?:ephone)?|vehicle|model)\b/i.test(cleaned)) return null;
  if (/\d{5,}/.test(cleaned) || (/[฀-๿]/.test(cleaned) && /\d/.test(cleaned))) return null;
  return cleaned.slice(0, 100);
}

export function sanitizeAiPlate(value: string | null) {
  const cleaned = value?.replace(/^(?:car\s*plate|plate\s*number|license\s*plate|ทะเบียน|车牌号码|车牌号|车牌)\s*(?::|：|\.)+\s*/i, "").trim() || null;
  if (!cleaned || /\b(?:driver|mobile|phone|tel(?:ephone)?)\b/i.test(cleaned)) return null;
  // Thai plates may be Thai letters + numbers + a province; retain the fleet's
  // original text rather than collapsing it to the numeric part.
  if (!/[\d฀-๿]/.test(cleaned)) return null;
  return cleaned.slice(0, 120);
}

function mergeAiText(result: Analysis, vision: FleetTextVision, orders: CandidateOrder[], sourceText: string) {
  if (vision.provider === "NONE") {
    result.recognition = { provider: "RULES", label: "规则降级", note: vision.note };
    return;
  }
  result.recognition = { provider: vision.provider, label: vision.provider === "GLM" ? "AI：GLM" : "AI：Qwen", note: vision.note };
  for (const item of vision.records) {
    const exact = item.order_number ? orders.find((order) => {
      const number = normalizedOrderNo(order.orderNo);
      if (number !== normalizedOrderNo(item.order_number!) || !/^\d+$/.test(number)) return false;
      // Candidate order numbers are included in the prompt for context, not
      // as evidence. Require the exact number to occur in the user's text.
      return new RegExp(`(?<!\\d)${number.split("").join("[ \\u00a0]*")}(?!\\d)`).test(sourceText);
    }) : undefined;
    // A Chinese or free-form order header may not have produced a matching
    // rule record. Reuse an unassigned record only for a single-record reply;
    // never attach unknown fields to another order in a multi-order reply.
    let target = exact ? result.records.find((record) => record.order_match.platform_order_number === exact.orderNo) : !item.order_number && result.records.length === 1 ? result.records[0] : undefined;
    if (!target && exact && result.records.length === 1 && vision.records.length === 1 && !result.records[0].order_match.platform_order_number) target = result.records[0];
    if (!target && exact) { target = emptyPackageRecord(result.records.length); result.records.push(target); }
    if (!target) continue;
    if (exact) {
      target.order_match = { platform_order_number: exact.orderNo, confidence: item.confidence === "HIGH" ? "high" : "medium", evidence: `${result.recognition.label} 从原文识别订单号` };
      target.review_reasons = target.review_reasons.filter((reason) => reason !== "缺少可匹配的订单号");
      if (item.confidence !== "HIGH" && !target.review_reasons.includes("AI 识别置信度不足，请人工核对")) target.review_reasons.push("AI 识别置信度不足，请人工核对");
      target.needs_review = target.review_reasons.length > 0;
    }
    const name = sanitizeAiDriverName(item.driver_name);
    const plate = sanitizeAiPlate(item.license_plate);
    if (name) target.driver_name = field(name, `${result.recognition.label} 识别，需人工核对`);
    if (item.driver_phone) target.driver_phone = field(item.driver_phone, `${result.recognition.label} 识别，需人工核对`);
    if (plate) target.license_plate = field(plate, `${result.recognition.label} 识别，保留车牌原文`);
    if (item.vehicle_category) target.vehicle_category = field(item.vehicle_category, `${result.recognition.label} 识别`);
    // Brand is useful evidence even if this particular image/text fragment
    // does not name a model. It can safely complete a verified historical
    // model later in the same analysis pass.
    if (!target.vehicle_brand.value && item.vehicle_brand) target.vehicle_brand = field(item.vehicle_brand, `${result.recognition.label} 识别`);
    if (item.vehicle_model) applyRecognizedVehicle(target, item.vehicle_brand, item.vehicle_model, `${result.recognition.label} 识别`, item.confidence);
  }
}

function autoMatchSingleUnassigned(records: ReplyRecord[], orders: CandidateOrder[], sourceText: string) {
  // Exact order numbers are the only automatic identity evidence. A missing
  // order must never be replaced with a similar passenger, time or remaining row.
  const headers = [...sourceText.matchAll(orderHeader)];
  const numbers = [...new Set(headers.map((match) => normalizedOrderNo(match[1])))];
  if (numbers.length !== 1 || records.length !== 1 || records[0].order_match.platform_order_number) return;
  const exact = orders.filter((order) => normalizedOrderNo(order.orderNo) === numbers[0]);
  if (exact.length !== 1) return;
  records[0].order_match = { platform_order_number: exact[0].orderNo, confidence: "high", evidence: "原文精确订单号唯一匹配" };
  records[0].needs_review = false;
  records[0].review_reasons = [];

}

function resolveProfile(reply: { createdBy: string | null; rawText: string }, orders: CandidateOrder[]): FleetProfile {
  const requested = reply.createdBy?.split("|")[1] as FleetProfile | undefined;
  if (requested === "BANGKOK" || requested === "SAMUI" || requested === "KUALA_LUMPUR") return requested;
  const normalized = normalizedOrderNo(reply.rawText);
  const matchedCities = new Set(orders.filter((order) => normalized.includes(normalizedOrderNo(order.orderNo))).map((order) => order.city));
  if (matchedCities.size === 1) return [...matchedCities][0] === "苏梅" ? "SAMUI" : [...matchedCities][0] === "吉隆坡" ? "KUALA_LUMPUR" : "BANGKOK";
  return "AUTO";
}

function parseBangkokRecords(text: string, orders: CandidateOrder[]): Analysis {
  const records = orderBlocks(text).map((block, source_index) => {
    const orderNo = exactBlockOrderNumber(block);
    const exact = orderNo ? orders.find((order) => normalizedOrderNo(order.orderNo) === normalizedOrderNo(orderNo)) : undefined;
    const driverReply = bangkokDriverReplySection(block);
    return {
      source_index,
      order_match: { platform_order_number: exact?.orderNo ?? null, confidence: exact ? "high" as const : "low" as const, evidence: exact ? "原文包含订单号" : "原文未找到可用订单号" },
      driver_name: field(readName(driverReply), "从订单末尾的车队回复区读取"),
      driver_phone: field(readPhone(driverReply), "从订单末尾的车队回复区读取"),
      license_plate: field(readPlate(driverReply), "从订单末尾的车队回复区读取"),
      vehicle_category: field(null, ""),
      vehicle_brand: field(null, ""),
      vehicle_model_raw: field(readVehicleModel(driverReply, false), "按车队 Type/Model 标注读取；无标注时使用对应车辆图片"),
      vehicle_model: field(readVehicleModel(driverReply, false), "按车队 Type/Model 标注读取；无标注时使用对应车辆图片"),
      image_source_index: null,
      needs_review: !exact,
      review_reasons: exact ? [] : ["缺少可匹配的订单号"],
    };
  });
  autoMatchSingleUnassigned(records, orders, text);
  return { records, unmatched_items: [] };
}

function parseSamuiRecords(text: string, orders: CandidateOrder[]): Analysis {
  // i'way 订单号原先多为 6 位，现在也会出现 7 位，并且 esforty 常把
  // 7 位订单号显示成 “1 015 534”。三种写法都必须识别为一笔新回复，
  // 否则下一笔的姓名和电话会被并入前一笔。
  const orderNoPattern = "(?:\\d{3}\\s*\\d{3,4}|\\d\\s+\\d{3}\\s+\\d{3})";
  const starts = [...text.matchAll(new RegExp(`(?:^|\\n)\\s*(${orderNoPattern})\\b`, "g"))];
  const blocks = starts.length ? starts.map((match, index) => text.slice(match.index, starts[index + 1]?.index ?? text.length)) : [text];
  const records = blocks.map((block, source_index) => {
    const orderNo = firstMatch(block, new RegExp(`^\\s*(${orderNoPattern})\\b`, "m"));
    const exact = orderNo ? orders.find((order) => normalizedOrderNo(order.orderNo) === normalizedOrderNo(orderNo)) : undefined;
    const phone = readPhone(block);
    const model = readVehicleModel(block)?.replace(/\s+(?:\d{1,2}-\d{3,5}|\d{3,5})\s*$/, "") ?? null;
    const plate = block.match(/(?:,|\s)(\d{1,2}-\d{3,5}|\d{3,5})\s*$/m)?.[1]
      ?? firstMatch(block, /(?:toyota\s+ventury|toyota\s+commut(?:er)?|mitsubishi\s+pajero)\s+(\d{3,5})\b/i)
      ?? readPlate(block);
    // readPhone returns several contacts joined by “/”. That joined string
    // does not occur literally in the source. Use its first raw contact to
    // locate the name, rather than slicing at -1 and accidentally producing
    // an empty driver name.
    const firstPhone = phone?.split("/")[0] ?? null;
    const phoneAt = firstPhone ? block.indexOf(firstPhone) : -1;
    const beforePhone = phoneAt >= 0 ? block.slice(0, phoneAt) : block;
    const name = readName(block) ?? beforePhone
      .replace(new RegExp(`^\\s*${orderNoPattern}\\s*[,，:]?\\s*`, "m"), "")
      .replace(/\b(?:toyota\s+commut(?:er)?|commut(?:er)?\s+toyota|toyota\s+ventury|mitsubishi\s+pajero|(?:toyota\s+)?all\s+new\s+v9|toyota\s+hiace)\b/ig, "")
      .replace(/\b\d{1,2}-\d{3,5}\b|\b\d{3,5}\b/g, "")
      .split(/[,，]/).map((value) => value.trim()).filter(Boolean).at(-1) ?? null;
    return {
      source_index,
      order_match: { platform_order_number: exact?.orderNo ?? null, confidence: exact ? "high" as const : "low" as const, evidence: exact ? "苏梅回复行首包含订单号" : "苏梅回复未提供可用订单号" },
      driver_name: field(name, "订单号后的姓名字段"),
      driver_phone: field(phone, "订单号行中的泰国电话"),
      license_plate: field(plate, "订单号行末车牌数字"),
      vehicle_category: field(null, ""),
      vehicle_brand: field(null, ""),
      vehicle_model_raw: field(model, "订单号行中的具体车型"),
      vehicle_model: field(model, "订单号行中的具体车型"),
      image_source_index: null,
      needs_review: !exact,
      review_reasons: exact ? [] : ["缺少可匹配的订单号"],
    };
  });
  autoMatchSingleUnassigned(records, orders, text);
  return { records, unmatched_items: [] };
}

async function translateThaiNames(records: ReplyRecord[]) {
  const names = [...new Set(records.map((record) => record.driver_name.value).filter(hasThai))] as string[];
  if (!names.length) return;
  const historic = await findConfirmedEnglishDriverNames(names);
  const remaining = names.filter((name) => !historic.has(name));
  const ai = remaining.length && isAiNameTransliterationEnabled() && isQwenConfigured() ? await transliterateThaiDriverNames(remaining) : null;
  records.forEach((record) => {
    const thai = record.driver_name.value?.trim();
    if (!thai) return;
    const english = historic.get(thai) ?? ai?.names.get(thai);
    if (english) record.driver_name = field(english, historic.has(thai) ? `复用已确认英文姓名；泰文原名“${thai}”` : `AI 音译泰文原名“${thai}”，请人工核对`);
    else record.driver_name = field(thai, ai?.message ?? "未找到历史英文姓名，且姓名 AI 转写未开启；已保留泰文原名");
  });
}

async function applyVehicleHistory(records: ReplyRecord[]) {
  const plates = [...new Set(records.map((record) => normalizePlate(record.license_plate.value)).filter(Boolean))];
  if (!plates.length) return;
  // There is no normalized-plate column in the production schema.  Fetch a
  // bounded history and compare conservatively in memory, so spacing/hyphen
  // variants of Thai plates can reuse confirmed data without a migration.
  const candidates = await db.driverDetail.findMany({ where: { licensePlate: { not: null }, confirmedVehicleModel: { not: null } }, orderBy: { updatedAt: "desc" }, take: 1_000, select: { licensePlate: true, confirmedVehicleModel: true } });
  for (const record of records) {
    if (record.vehicle_model.value) continue;
    const plate = normalizePlate(record.license_plate.value);
    const historic = candidates.find((item) => normalizePlate(item.licensePlate) === plate && item.confirmedVehicleModel);
    if (historic?.confirmedVehicleModel) record.vehicle_model = field(historic.confirmedVehicleModel, "按相同车牌复用已确认的历史车型");
  }
}

async function applyScreenshotImages(records: ReplyRecord[], images: { storagePath: string }[], orders: CandidateOrder[]) {
  if (!images.length) return;
  const scans = await Promise.all(images.slice(0, 4).map((image) => recognizeFleetScreenshot(image.storagePath)));
  scans.forEach((scan, index) => {
    if (scan.provider === "NONE") return;
    scan.records.forEach((item) => {
      const exact = item.order_number ? orders.find((order) => normalizedOrderNo(order.orderNo) === normalizedOrderNo(item.order_number!)) : undefined;
      const target = exact ? records.find((record) => record.order_match.platform_order_number === exact.orderNo) ?? records.find((record) => !record.order_match.platform_order_number) : records.length === 1 ? records[0] : undefined;
      if (!target) return;
      if (exact) { target.order_match = { platform_order_number: exact.orderNo, confidence: item.confidence === "HIGH" ? "high" : "medium", evidence: `截图 ${index + 1} 识别到订单号` }; target.needs_review = false; target.review_reasons = []; }
      const merge = (key: "driver_name" | "driver_phone" | "license_plate", value: string | null) => {
        if (!value) return;
        if (!target[key].value) target[key] = field(value, `来自截图 ${index + 1}`);
        else if (target[key].value !== value) { target.needs_review = true; target.review_reasons.push(`截图 ${index + 1} 的${key}与已有资料冲突，请人工确认`); }
      };
      merge("driver_name", item.driver_name); merge("driver_phone", item.driver_phone); merge("license_plate", item.license_plate);
      if (!target.vehicle_model.value && item.vehicle_model) applyRecognizedVehicle(target, item.vehicle_brand, item.vehicle_model, `来自截图 ${index + 1}`, item.confidence);
      if (item.confirmation_status === "PENDING_DETAILS") { target.needs_review = true; target.review_reasons.push("车队表示稍后提供资料，当前不能视为司机资料完整"); }
      if (item.confirmation_status === "DECLINED") { target.needs_review = true; target.review_reasons.push("截图显示车队可能无法安排，请人工确认订单状态"); }
      target.image_source_index = index + 1;
    });
  });
}

async function readVehicleImage(image: { storagePath: string }): Promise<VisualResult | null> {
  const result = await recognizeVehicleImage(image.storagePath);
  return result.provider === "NONE" ? null : result;
}

async function applyVehicleImages(records: ReplyRecord[], images: { storagePath: string }[], orders: CandidateOrder[]) {
  if (!images.length) return;
  const results = await Promise.all(images.slice(0, 4).map((image) => readVehicleImage(image)));
  const recordsByPickup = [...records].sort((left, right) => {
    const leftPickup = orders.find((order) => order.orderNo === left.order_match.platform_order_number)?.pickup ?? "";
    const rightPickup = orders.find((order) => order.orderNo === right.order_match.platform_order_number)?.pickup ?? "";
    return leftPickup.localeCompare(rightPickup);
  });
  results.forEach((visual, imageIndex) => {
    if (!visual) return;
    let target = records.find((record) => normalizePlate(record.license_plate.value) && normalizePlate(record.license_plate.value) === normalizePlate(visual.license_plate));
    if (!target && records.length === images.length) target = recordsByPickup[imageIndex];
    if (!target) return;
    target.image_source_index = imageIndex + 1;
    if (!target.license_plate.value && visual.license_plate) target.license_plate = field(visual.license_plate, `来自车辆图片 ${imageIndex + 1}`);
    // 车队文字已经给出具体车型时优先采用文字；图片只作为核对来源。
    if (!target.vehicle_model.value && visual.vehicle_model) applyRecognizedVehicle(target, visual.vehicle_brand, visual.vehicle_model, `来自车辆图片 ${imageIndex + 1}`, visual.confidence);
    if (!target.vehicle_category.value && visual.vehicle_category) target.vehicle_category = field(visual.vehicle_category, `来自车辆图片 ${imageIndex + 1}`);
  });
}

function emptyPackageRecord(sourceIndex: number): ReplyRecord {
  return { source_index: sourceIndex, order_match: { platform_order_number: null, confidence: "low", evidence: "资料包中未找到可用订单号" }, driver_name: field(null, ""), driver_phone: field(null, ""), license_plate: field(null, ""), vehicle_category: field(null, ""), vehicle_brand: field(null, ""), vehicle_model_raw: field(null, ""), vehicle_model: field(null, ""), image_source_index: null, needs_review: true, review_reasons: ["缺少可匹配的订单号"] };
}

function addReview(target: ReplyRecord, reason: string) {
  target.needs_review = true;
  if (!target.review_reasons.includes(reason)) target.review_reasons.push(reason);
}

function sameField(key: "driver_name" | "driver_phone" | "license_plate", left: string, right: string) {
  if (key === "license_plate") return normalizePlate(left) === normalizePlate(right);
  if (key === "driver_phone") return left.replace(/\D/g, "") === right.replace(/\D/g, "");
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/** Merge a whole upload package after, rather than before, the deterministic
 * order boundary is known.  This deliberately does not save anything. */
export function applyFleetPackage(records: ReplyRecord[], vision: FleetPackageVision, orders: CandidateOrder[]) {
  if (vision.provider === "NONE") return false;
  const exactItems = vision.records.filter((item) => item.order_number && orders.some((order) => normalizedOrderNo(order.orderNo) === normalizedOrderNo(item.order_number!)));
  const distinctOrders = new Set([...vision.records.filter((item) => item.order_number).map((item) => normalizedOrderNo(item.order_number!)), ...records.flatMap((record) => record.order_match.platform_order_number ? [normalizedOrderNo(record.order_match.platform_order_number)] : [])]);
  const packageHasOneExactOrder = distinctOrders.size === 1;
  const driverSignatures = new Set(exactItems.filter((item) => item.driver_name || item.driver_phone || item.license_plate).map((item) => `${item.driver_name?.toLowerCase() ?? ""}|${item.driver_phone?.replace(/\D/g, "") ?? ""}|${normalizePlate(item.license_plate)}`));
  for (const [index, item] of vision.records.entries()) {
    const exact = item.order_number ? orders.find((order) => normalizedOrderNo(order.orderNo) === normalizedOrderNo(item.order_number!)) : undefined;
    let target = exact ? records.find((record) => normalizedOrderNo(record.order_match.platform_order_number ?? "") === normalizedOrderNo(exact.orderNo)) ?? records.find((record) => !record.order_match.platform_order_number) : undefined;
    // A package with exactly one known order may supply the driver details in
    // another picture without repeating the order number.
    if (!target && !item.order_number && packageHasOneExactOrder) {
      const only = orders.find((order) => normalizedOrderNo(order.orderNo) === [...distinctOrders][0]);
      target = only ? records.find((record) => normalizedOrderNo(record.order_match.platform_order_number ?? "") === normalizedOrderNo(only.orderNo)) ?? records.find((record) => !record.order_match.platform_order_number) : undefined;
      if (!target && only) { target = emptyPackageRecord(100 + index); records.push(target); }
    }
    if (!target && exact) { target = emptyPackageRecord(100 + index); records.push(target); }
    if (!target && (item.driver_name || item.driver_phone || item.license_plate || item.vehicle_model)) {
      target = emptyPackageRecord(100 + index);
      addReview(target, "多订单资料缺少明确归属，请人工选择对应订单");
      records.push(target);
    }
    if (!target) continue;
    const source = item.source_image_indexes.length ? `资料包图片 ${item.source_image_indexes.join("、")}` : "资料包原文";
    if (exact) {
      target.order_match = { platform_order_number: exact.orderNo, confidence: item.confidence === "HIGH" ? "high" : "medium", evidence: `${source} 精确识别订单号` };
      target.review_reasons = target.review_reasons.filter((reason) => reason !== "缺少可匹配的订单号");
      target.needs_review = target.review_reasons.length > 0;
    }
    const merge = (key: "driver_name" | "driver_phone" | "license_plate", value: string | null) => {
      if (!value) return;
      if (!target![key].value) target![key] = field(value, `来自${source}`);
      else if (!sameField(key, target![key].value!, value)) addReview(target!, `${source} 的${key}与同一订单已有资料冲突，请人工确认`);
    };
    // A wallet payee is a weak identity clue, never a driver identity on its
    // own unless this submission has one exact order and no competing name.
    if (item.driver_name && (item.driver_name_source !== "EWALLET_PAYEE" || (packageHasOneExactOrder && !target.driver_name.value))) merge("driver_name", sanitizeAiDriverName(item.driver_name));
    if (item.driver_name_source === "EWALLET_PAYEE") addReview(target, "电子钱包收款人仅作为候选司机姓名，请人工核对");
    merge("driver_phone", item.driver_phone); merge("license_plate", sanitizeAiPlate(item.license_plate));
    if (!target.vehicle_category.value && item.vehicle_category) target.vehicle_category = field(item.vehicle_category, `来自${source}`);
    if (!target.vehicle_brand.value && item.vehicle_brand) target.vehicle_brand = field(item.vehicle_brand, `来自${source}`);
    if (!target.vehicle_model.value && item.vehicle_model) applyRecognizedVehicle(target, item.vehicle_brand, item.vehicle_model, `来自${source}`, item.confidence);
    if (!target.vehicle_color?.value && item.vehicle_color) target.vehicle_color = field(item.vehicle_color, `来自${source}`);
    if (item.source_image_indexes.length) target.image_source_index = item.source_image_indexes[0] ?? null;
    if (item.confirmation_status === "PENDING_DETAILS") addReview(target, "车队表示稍后提供资料，当前不能视为司机资料完整");
    if (item.confirmation_status === "DECLINED") addReview(target, "截图显示车队可能无法安排，请人工确认订单状态");
    if (item.confidence !== "HIGH") addReview(target, "AI 资料包识别置信度不足，请人工核对");
  }
  if (packageHasOneExactOrder && driverSignatures.size > 1) {
    const order = orders.find((candidate) => normalizedOrderNo(candidate.orderNo) === [...distinctOrders][0]);
    const target = order && records.find((record) => normalizedOrderNo(record.order_match.platform_order_number ?? "") === normalizedOrderNo(order.orderNo));
    if (target) addReview(target, "同一资料包出现多套司机或车辆资料，不能自动保存");
  }
  return true;
}

export async function analyzeFleetReply(replyId: string) {
  const reply = await db.fleetReply.findUnique({ where: { id: replyId }, include: { images: true } });
  if (!reply) throw new Error("REPLY_NOT_FOUND");
  const orders = await candidateOrdersFor(reply);
  if (!orders.length) throw new Error("CONTEXT_REQUIRED");
  const profile = resolveProfile(reply, orders);
  // AI can understand a non-standard reply even when the city profile cannot
  // be inferred. The deterministic parser remains a validation/fallback only.
  const parserProfile = profile === "AUTO" ? "BANGKOK" : profile;
  const result = parserProfile === "SAMUI" ? parseSamuiRecords(reply.rawText, orders) : parseBangkokRecords(reply.rawText, orders);
  // A submission with images is analysed by the package model below. Running
  // the text model first would charge twice and could produce competing field
  // candidates for the same operator submission.
  if (reply.rawText.trim() && !reply.images.length) {
    const vision = await recognizeFleetReplyText(reply.rawText, orders.map((order) => order.orderNo));
    mergeAiText(result, vision, orders, reply.rawText);
  } else {
    result.recognition = { provider: "RULES", label: "AI 未调用", note: reply.images.length ? "将作为一个资料包联合识别。" : "未提供车队文字；仅在有截图时调用图片识别。" };
  }
  // One upload is one package.  A driver card or vehicle photo may omit the
  // order number while another image supplies it, so never analyse each image
  // as an independent order reply.
  if (reply.images.length) {
    const packageVision = await recognizeFleetPackage(reply.rawText, reply.images.map((image) => image.storagePath), orders.map((order) => order.orderNo));
    if (!applyFleetPackage(result.records, packageVision, orders)) {
      const disabled = !isAiVisionRealCallsEnabled();
      result.recognition = { provider: "RULES", label: disabled ? "AI 未开启" : "AI 服务暂不可用", note: packageVision.note };
      result.unmatched_items.push({ source_type: "image", source_id: "ai", reason: disabled
        ? "资料包图片识别尚未开启；原始资料已保存为草稿，可人工补充。"
        : `资料包图片识别未完成：${packageVision.note}。原始资料已保存为草稿，可人工补充。` });
    } else result.recognition = { provider: packageVision.provider === "GLM" ? "GLM" : "QWEN", label: packageVision.provider === "GLM" ? "AI：GLM 联合资料包" : "AI：Qwen 联合资料包", note: packageVision.note };
  }
  await translateThaiNames(result.records);
  await applyVehicleHistory(result.records);
  // Rule fallback and historical plate reuse must obey the same brand gate as
  // AI results. Never auto-save an unverified model-only fallback.
  for (const record of result.records) {
    const vehicle = resolveVehicleModel(record.vehicle_model.value, record.vehicle_brand.value, loadRules());
    // History may only have the model (for example “Hiace”), while this
    // package independently identifies the brand. Resolve those two pieces
    // together before the preview is persisted, so every downstream surface
    // receives the same complete canonical name (for example “Toyota HiAce”).
    // A conflicting brand deliberately keeps the historical text and is sent
    // to the existing manual-review path below.
    if (vehicle.value && vehicle.value !== record.vehicle_model.value) {
      record.vehicle_model = field(vehicle.value, `${record.vehicle_model.evidence}；结合本次识别品牌规范化`);
    }
    if (vehicle.needsManualReview) {
      record.needs_review = true;
      if (vehicle.reviewReason && !record.review_reasons.includes(vehicle.reviewReason)) record.review_reasons.push(vehicle.reviewReason);
    }
  }
  // 规则尚在校准期：分析只生成草稿，绝不自动改写订单资料。
  const autoWritten = 0;
  const extraction = await db.aiExtraction.create({ data: { fleetReplyId: reply.id, provider: result.recognition?.label ?? "规则降级", modelName: reply.images.length ? "glm-5.3-flash → qwen3.7-plus" : "glm-5.3-flash → qwen3.7-plus", promptVersion: `fleet-reply-v5-${parserProfile.toLowerCase()}`, rawModelJson: JSON.stringify(result), validatedResultJson: JSON.stringify(result), status: "SUCCEEDED" } });
  return { status: extraction.status, replyId, extractionId: extraction.id, result, orders, autoWritten, profile };
}

export async function getFleetReply(replyId: string) {
  const reply = await db.fleetReply.findUnique({ where: { id: replyId }, include: { images: true, extractions: { orderBy: { createdAt: "desc" }, take: 1 }, confirmations: { orderBy: { confirmedAt: "desc" } } } });
  if (!reply) throw new Error("REPLY_NOT_FOUND");
  const orders = await candidateOrdersFor(reply);
  const extraction = reply.extractions[0];
  return { id: reply.id, rawText: reply.rawText, images: reply.images.map(({ id, originalFilename, mimeType }) => ({ id, originalFilename, mimeType })), orders, extraction: extraction ? { id: extraction.id, status: extraction.status, message: extraction.errorMessage, result: extraction.validatedResultJson ? JSON.parse(extraction.validatedResultJson) : null } : null, confirmations: reply.confirmations };
}

type SavedAnalysisRecord = {
  order_match?: { platform_order_number?: string | null };
  needs_review?: boolean;
  vehicle_brand?: { value?: string | null };
  vehicle_model?: { value?: string | null };
};

export function requiresManualVehicleConfirmation(record: SavedAnalysisRecord | undefined, proposedVehicle?: string) {
  if (!record || record.needs_review !== false || !record.vehicle_model?.value) return true;
  return proposedVehicle !== undefined && proposedVehicle.trim() !== record.vehicle_model.value.trim();
}

export async function confirmFleetReply(replyId: string, input: { extractionId?: string; records: { orderId: string; driverName: string; driverPhone: string; licensePlate: string; vehicleCategory?: string; vehicleModel: string; vehicleManualConfirmed?: boolean }[] }) {
  const reply = await db.fleetReply.findUnique({ where: { id: replyId } });
  if (!reply) throw new Error("REPLY_NOT_FOUND");
  const candidates = await candidateOrdersFor(reply);
  const allowed = new Set(candidates.map((order) => order.id));
  const orderNoById = new Map(candidates.map((order) => [order.id, order.orderNo]));
  const extraction = await db.aiExtraction.findFirst({ where: { fleetReplyId: replyId, status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, select: { id: true, validatedResultJson: true } });
  if (input.extractionId && input.extractionId !== extraction?.id) return { valid: false, errors: [{ orderId: "", message: "分析记录不存在、已过期或不属于当前回复，请重新分析。" }], confirmed: 0 };
  let analysisRecords: SavedAnalysisRecord[] = [];
  try {
    const parsed = extraction?.validatedResultJson ? JSON.parse(extraction.validatedResultJson) : null;
    analysisRecords = Array.isArray(parsed?.records) ? parsed.records : [];
  } catch { analysisRecords = []; }
  const rules = loadRules();
  const accepted: { orderId: string; driverName: string; driverPhone: string; licensePlate: string; rawLicensePlate: string; vehicleCategory?: string; vehicleModel: string }[] = [];
  const errors: { orderId: string; message: string }[] = [];
  for (const record of input.records) {
    if (!allowed.has(record.orderId)) { errors.push({ orderId: record.orderId, message: "订单不属于当天候选范围，不能写入。" }); continue; }
    const current = await db.order.findUnique({ where: { id: record.orderId }, select: { status: true } });
    if (current?.status === "CANCELLED") { errors.push({ orderId: record.orderId, message: "订单已取消，不能写入司机资料。" }); continue; }
    const matchedAnalyses = analysisRecords.filter((item) => normalizedOrderNo(item.order_match?.platform_order_number ?? "") === normalizedOrderNo(orderNoById.get(record.orderId) ?? ""));
    const matchedAnalysis = matchedAnalyses.length === 1 ? matchedAnalyses[0] : undefined;
    if (requiresManualVehicleConfirmation(matchedAnalysis, record.vehicleModel) && record.vehicleManualConfirmed !== true) {
      errors.push({ orderId: record.orderId, message: "AI 车型存在品牌缺失或冲突；请先人工核对车型并勾选确认后再保存。" });
      continue;
    }
    const order = candidates.find((candidate) => candidate.id === record.orderId);
    const phone = normalizeDriverPhone(record.driverPhone, order?.city ?? "", rules);
    // Keep the manual-edit save path aligned with the analysis preview. A
    // reliable AI brand may complete a model-only manual value, but the
    // shared resolver still flags conflicting brands instead of guessing.
    const vehicleResolution = resolveVehicleModel(record.vehicleModel, matchedAnalysis?.vehicle_brand?.value, rules);
    const vehicle = vehicleResolution.value;
    const missing = [
      !phone ? (record.driverPhone.trim() ? "司机电话格式不正确" : "司机电话") : "",
      !record.licensePlate.trim() ? "车牌" : "",
      !vehicle ? "具体车型" : "",
    ].filter(Boolean);
    if (missing.length) { errors.push({ orderId: record.orderId, message: `${record.orderId}：请补充或修改${missing.join("、")}。` }); continue; }
    // The message above covers incomplete values; this guard also lets
    // TypeScript know the normalized values are present below.
    if (!phone || !vehicle) continue;
    if (rules.transforms.generic_vehicle_labels_not_allowed_for_return.some((item) => item.toLowerCase() === vehicle.toLowerCase())) { errors.push({ orderId: record.orderId, message: "i’way 回传需要具体车型，不能只填 Van、Minibus、Sedan 等大类。" }); continue; }
    const licensePlate = normalizeLicensePlateForReturn(record.licensePlate);
    if (!licensePlate) { errors.push({ orderId: record.orderId, message: `${record.orderId}：请补充或修改车牌。` }); continue; }
    accepted.push({ ...record, driverName: record.driverName.trim(), driverPhone: phone, licensePlate, rawLicensePlate: record.licensePlate.trim(), vehicleCategory: record.vehicleCategory?.trim() || undefined, vehicleModel: vehicle });
  }
  if (errors.length) return { valid: false, errors, confirmed: 0 };
  for (const record of accepted) await saveDriverDetails(record.orderId, { rawReply: reply.rawText, confirmedDriverName: record.driverName, rawDriverPhone: record.driverPhone, confirmedVehicleCategory: record.vehicleCategory ?? null, confirmedVehicleModel: record.vehicleModel, licensePlate: record.licensePlate, rawLicensePlate: record.rawLicensePlate });
  await db.$transaction(async (tx) => {
    await tx.driverDetailConfirmation.createMany({ data: accepted.map((record) => ({ orderId: record.orderId, fleetReplyId: replyId, extractionId: extraction?.id || null, finalDriverName: record.driverName, finalPhone: record.driverPhone, finalPlate: record.licensePlate, finalVehicleModel: record.vehicleModel, confirmedBy: "运营人员", rulesVersion: rules.rules_version })) });
    await tx.activityLog.createMany({ data: accepted.map((record) => ({ orderId: record.orderId, action: "确认车队回传资料", actor: "运营人员", metadata: `车队回复：${replyId}；规则版本：${rules.rules_version}` })) });
  });
  return { valid: true, errors: [], confirmed: accepted.length };
}
