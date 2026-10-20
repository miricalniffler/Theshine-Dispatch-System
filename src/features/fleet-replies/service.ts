import { z } from "zod";
import { db } from "@/lib/db";
import { loadRules } from "@/lib/rules/load-rules";
import { normalizeLicensePlateForReturn, normalizeThailandPhone, normalizeVehicleModel } from "@/lib/rules/engine";
import { saveDriverDetails } from "@/features/iway/service";
import { isQwenConfigured } from "@/features/assist/qwen";
import { findConfirmedEnglishDriverNames, isAiNameTransliterationEnabled, transliterateThaiDriverNames } from "@/features/assist/service";
import { isAiVisionRealCallsEnabled, recognizeFleetReplyText, recognizeFleetScreenshot, recognizeVehicleImage, type FleetTextVision } from "@/features/assist/vision";

type CandidateOrder = { id: string; orderNo: string; passengerName: string; pickup: string; route: string; city: string; fleetName: string };
type Field = { value: string | null; evidence: string };
type ReplyRecord = {
  source_index: number;
  order_match: { platform_order_number: string | null; confidence: "high" | "medium" | "low"; evidence: string };
  driver_name: Field;
  driver_phone: Field;
  license_plate: Field;
  vehicle_category: Field;
  vehicle_model: Field;
  image_source_index: number | null;
  needs_review: boolean;
  review_reasons: string[];
};
type Analysis = { records: ReplyRecord[]; unmatched_items: { source_type: "text" | "image"; source_id: string; reason: string }[]; recognition?: { provider: "GLM" | "QWEN" | "RULES"; label: string; note: string } };
type VisualResult = { vehicle_model: string | null; vehicle_category: string | null; license_plate: string | null };
type FleetProfile = "AUTO" | "BANGKOK" | "SAMUI";

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
    pickup: `${order.serviceDate} ${order.pickupDateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}`,
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
  const city = input.fleetProfile === "SAMUI" ? "苏梅" : input.fleetProfile === "BANGKOK" ? "曼谷" : undefined;
  const dateOrderIds = input.orderIds?.length ? [] : (await db.order.findMany({ where: { serviceDate: selectedDate, status: { notIn: ["CANCELLED"] }, ...(city ? { city } : {}) }, select: { id: true } })).map((order) => order.id);
  const orderIds = [...new Set([...(input.orderIds ?? []), ...dateOrderIds])];
  if (!rawText && !(input.images?.length)) throw new Error("SOURCE_REQUIRED");
  const profile = input.fleetProfile ?? "AUTO";
  const reply = await db.fleetReply.create({ data: { dispatchBatchId: input.dispatchBatchId || null, candidateOrderIds: orderIds.length ? JSON.stringify(orderIds) : null, rawText, createdBy: `运营人员|${profile}`, images: { create: (input.images ?? []).map((image) => ({ storagePath: image.dataUrl, originalFilename: image.filename || null, mimeType: image.mimeType || "image/*" })) } }, include: { images: true } });
  return { id: reply.id, rawText: reply.rawText, imageCount: reply.images.length };
}

function orderBlocks(text: string) {
  const matches = [...text.matchAll(/(?:^|\n)\s*order\s*number\s*[:：]\s*([a-z0-9-]+)/gim)];
  if (!matches.length) return [text];
  return matches.map((match, index) => text.slice(match.index, matches[index + 1]?.index ?? text.length));
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
  const labelled = firstMatch(block, /(?:driver\s*name|driver|name)\s*(?::|：|\.)+\s*([^\n]+)/i);
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
    const matches = [...line.matchAll(/(?:\+\s*66[\s-]*|0)\d(?:[\d -]*\d)/g)].map((match) => match[0].trim());
    return matches.filter((value) => value.replace(/\D/g, "").length >= 9);
  });
  // If the fleet gave local Thai numbers, they are the reply's intended
  // contacts. Ignore a later +66 number from another pasted reply block.
  const local = linePhones.filter((value) => value.replace(/\D/g, "").startsWith("0"));
  const phones = local.length ? local : linePhones;
  return phones.length ? [...new Set(phones)].join("/") : null;
}

function readPlate(block: string) {
  const labelled = firstMatch(block, /(?:car\s*(?:no|number|plate)|plate|license\s*plate|ทะเบียน)\s*(?::|：|\.)+\s*([^\n]+)/i);
  if (labelled) return labelled;
  const lines = block.split("\n").map((line) => line.trim());
  const value = lines.find((line) => /^(?:\d{3,5}|[ก-๙]{1,3}\s*\d{1,4}|\d{1,2}[ก-๙]{1,3}\s*\d{1,4})$/i.test(line));
  return value?.match(/\d{3,5}/)?.[0] ?? null;
}

function readVehicleModel(block: string, allowInlineModel = true) {
  const labelled = firstMatch(block, /(?:vehicle\s*(?:type|model)?|type|model|van|minibus|sedan|suv)\s*(?::|：|\.)+\s*([^\n]+)/i);
  if (labelled && !/^(?:minibus|minivan|van|sedan|standard)$/i.test(labelled)) return labelled;
  return allowInlineModel ? firstMatch(block, /\b((?:toyota|hyundai|honda|isuzu|mitsubishi|mercedes)[^,\n]{0,45})/i) : null;
}

export function sanitizeAiDriverName(value: string | null) {
  const cleaned = value?.replace(/^(?:driver(?:\s*name)?|name)\s*(?::|：|\.)+\s*/i, "").trim() || null;
  if (!cleaned || /\b(?:car\s*plate|plate\s*number|license\s*plate|mobile|phone|tel(?:ephone)?|vehicle|model)\b/i.test(cleaned)) return null;
  if (/\d{5,}/.test(cleaned) || (/[฀-๿]/.test(cleaned) && /\d/.test(cleaned))) return null;
  return cleaned.slice(0, 100);
}

export function sanitizeAiPlate(value: string | null) {
  const cleaned = value?.replace(/^(?:car\s*plate|plate\s*number|license\s*plate|ทะเบียน)\s*(?::|：|\.)+\s*/i, "").trim() || null;
  if (!cleaned || /\b(?:driver|mobile|phone|tel(?:ephone)?)\b/i.test(cleaned)) return null;
  // Thai plates may be Thai letters + numbers + a province; retain the fleet's
  // original text rather than collapsing it to the numeric part.
  if (!/[\d฀-๿]/.test(cleaned)) return null;
  return cleaned.slice(0, 120);
}

function mergeAiText(result: Analysis, vision: FleetTextVision, orders: CandidateOrder[]) {
  if (vision.provider === "NONE") {
    result.recognition = { provider: "RULES", label: "规则降级", note: vision.note };
    return;
  }
  result.recognition = { provider: vision.provider, label: vision.provider === "GLM" ? "AI：GLM" : "AI：Qwen", note: vision.note };
  for (const item of vision.records) {
    const exact = item.order_number ? orders.find((order) => normalizedOrderNo(order.orderNo) === normalizedOrderNo(item.order_number!)) : undefined;
    const target = exact ? result.records.find((record) => record.order_match.platform_order_number === exact.orderNo) : result.records.length === 1 ? result.records[0] : undefined;
    if (!target) continue;
    if (exact) {
      target.order_match = { platform_order_number: exact.orderNo, confidence: item.confidence === "HIGH" ? "high" : "medium", evidence: `${result.recognition.label} 从原文识别订单号` };
      target.needs_review = false;
      target.review_reasons = [];
    }
    const name = sanitizeAiDriverName(item.driver_name);
    const plate = sanitizeAiPlate(item.license_plate);
    if (name) target.driver_name = field(name, `${result.recognition.label} 识别，需人工核对`);
    if (item.driver_phone) target.driver_phone = field(item.driver_phone, `${result.recognition.label} 识别，需人工核对`);
    if (plate) target.license_plate = field(plate, `${result.recognition.label} 识别，保留车牌原文`);
    if (item.vehicle_category) target.vehicle_category = field(item.vehicle_category, `${result.recognition.label} 识别`);
    if (item.vehicle_model) target.vehicle_model = field(item.vehicle_model, `${result.recognition.label} 识别`);
  }
}

function autoMatchSingleUnassigned(records: ReplyRecord[], orders: CandidateOrder[], sourceText: string) {
  const unassigned = records.filter((record) => !record.order_match.platform_order_number);
  if (unassigned.length !== 1) return;
  const occupied = new Set(records.map((record) => record.order_match.platform_order_number).filter(Boolean).map((value) => normalizedOrderNo(value!)));
  const remaining = orders.filter((order) => !occupied.has(normalizedOrderNo(order.orderNo)));
  const pickupTimes = [...sourceText.matchAll(/pickup\s*time\s*[:：]\s*\d{4}-\d{2}-\d{2}\s+(\d{1,2}:\d{2})/gi)].map((match) => match[1]);
  const byTime = pickupTimes.length === 1 ? remaining.filter((order) => order.pickup.endsWith(pickupTimes[0].padStart(5, "0"))) : [];
  const byPassenger = remaining.filter((order) => sourceText.toLowerCase().includes(order.passengerName.toLowerCase()));
  const matched = byTime.length === 1 ? byTime[0] : byPassenger.length === 1 ? byPassenger[0] : remaining.length === 1 ? remaining[0] : null;
  if (!matched) return;
  const evidence = byTime.length === 1 ? "原文接车时间唯一匹配" : byPassenger.length === 1 ? "原文乘客姓名唯一匹配" : "当天仅剩一笔未匹配订单，按唯一剩余订单自动归属";
  unassigned[0].order_match = { platform_order_number: matched.orderNo, confidence: "high", evidence };
  unassigned[0].needs_review = false;
  unassigned[0].review_reasons = [];
}

function resolveProfile(reply: { createdBy: string | null; rawText: string }, orders: CandidateOrder[]): FleetProfile {
  const requested = reply.createdBy?.split("|")[1] as FleetProfile | undefined;
  if (requested === "BANGKOK" || requested === "SAMUI") return requested;
  const normalized = normalizedOrderNo(reply.rawText);
  const matchedCities = new Set(orders.filter((order) => normalized.includes(normalizedOrderNo(order.orderNo))).map((order) => order.city));
  if (matchedCities.size === 1) return [...matchedCities][0].includes("苏梅") ? "SAMUI" : "BANGKOK";
  return "AUTO";
}

function parseBangkokRecords(text: string, orders: CandidateOrder[]): Analysis {
  const records = orderBlocks(text).map((block, source_index) => {
    const orderNo = firstMatch(block, /order\s*number\s*[:：]\s*([a-z0-9-]+)/i);
    const exact = orderNo ? orders.find((order) => normalizedOrderNo(order.orderNo) === normalizedOrderNo(orderNo)) : undefined;
    const driverReply = bangkokDriverReplySection(block);
    return {
      source_index,
      order_match: { platform_order_number: exact?.orderNo ?? null, confidence: exact ? "high" as const : "low" as const, evidence: exact ? "原文包含订单号" : "原文未找到可用订单号" },
      driver_name: field(readName(driverReply), "从订单末尾的车队回复区读取"),
      driver_phone: field(readPhone(driverReply), "从订单末尾的车队回复区读取"),
      license_plate: field(readPlate(driverReply), "从订单末尾的车队回复区读取"),
      vehicle_category: field(null, ""),
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
    const name = beforePhone
      .replace(new RegExp(`^\\s*${orderNoPattern}\\s*[,，:]?\\s*`, "m"), "")
      .replace(/\b(?:toyota\s+commut(?:er)?|commut(?:er)?\s+toyota|toyota\s+ventury|mitsubishi\s+pajero|(?:toyota\s+)?all\s+new\s+v9|toyota\s+hiace)\b/ig, "")
      .replace(/\b\d{1,2}-\d{3,5}\b|\b\d{3,5}\b/g, "")
      .split(/[,，]/).map((value) => value.trim()).filter(Boolean).at(-1) || null;
    return {
      source_index,
      order_match: { platform_order_number: exact?.orderNo ?? null, confidence: exact ? "high" as const : "low" as const, evidence: exact ? "苏梅回复行首包含订单号" : "苏梅回复未提供可用订单号" },
      driver_name: field(name, "订单号后的姓名字段"),
      driver_phone: field(phone, "订单号行中的泰国电话"),
      license_plate: field(plate, "订单号行末车牌数字"),
      vehicle_category: field(null, ""),
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
    const exact = scan.order_number ? orders.find((order) => normalizedOrderNo(order.orderNo) === normalizedOrderNo(scan.order_number!)) : undefined;
    const target = exact ? records.find((record) => record.order_match.platform_order_number === exact.orderNo) ?? records.find((record) => !record.order_match.platform_order_number) : records.length === 1 ? records[0] : undefined;
    if (!target) return;
    if (exact) { target.order_match = { platform_order_number: exact.orderNo, confidence: scan.confidence === "HIGH" ? "high" : "medium", evidence: `截图 ${index + 1} 识别到订单号` }; target.needs_review = false; target.review_reasons = []; }
    if (!target.driver_name.value && scan.driver_name) target.driver_name = field(scan.driver_name, `来自截图 ${index + 1}`);
    if (!target.driver_phone.value && scan.driver_phone) target.driver_phone = field(scan.driver_phone, `来自截图 ${index + 1}`);
    if (!target.license_plate.value && scan.license_plate) target.license_plate = field(scan.license_plate, `来自截图 ${index + 1}`);
    if (!target.vehicle_model.value && scan.vehicle_model) target.vehicle_model = field(scan.vehicle_model, `来自截图 ${index + 1}`);
    target.image_source_index = index + 1;
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
    if (!target.vehicle_model.value && visual.vehicle_model) target.vehicle_model = field(visual.vehicle_model, `来自车辆图片 ${imageIndex + 1}`);
    if (!target.vehicle_category.value && visual.vehicle_category) target.vehicle_category = field(visual.vehicle_category, `来自车辆图片 ${imageIndex + 1}`);
  });
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
  if (reply.rawText.trim()) {
    const vision = await recognizeFleetReplyText(reply.rawText, orders.map((order) => order.orderNo));
    mergeAiText(result, vision, orders);
  } else {
    result.recognition = { provider: "RULES", label: "AI 未调用", note: "未提供车队文字；仅在有截图时调用图片识别。" };
  }
  // Image-only replies are chat screenshots. Do not run OCR on normal
  // text-and-vehicle-photo replies, which keeps paid calls bounded.
  if (!reply.rawText.trim()) {
    if (!isAiVisionRealCallsEnabled()) result.unmatched_items.push({ source_type: "image", source_id: "ai", reason: "图片识别尚未开启：请联系管理员仅在测试环境设置 AI_VISION_REAL_CALLS_ENABLED=true，或人工录入。" });
    else await applyScreenshotImages(result.records, reply.images, orders);
  }
  await translateThaiNames(result.records);
  if (reply.rawText.trim()) {
    if (reply.images.length && !isAiVisionRealCallsEnabled()) result.unmatched_items.push({ source_type: "image", source_id: "ai", reason: "车辆图片识别尚未开启；原始图片已保留，可人工填写车型和车牌。" });
    else await applyVehicleImages(result.records, reply.images, orders);
  }
  await applyVehicleHistory(result.records);
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

export async function confirmFleetReply(replyId: string, input: { extractionId?: string; records: { orderId: string; driverName: string; driverPhone: string; licensePlate: string; vehicleCategory?: string; vehicleModel: string }[] }) {
  const reply = await db.fleetReply.findUnique({ where: { id: replyId } });
  if (!reply) throw new Error("REPLY_NOT_FOUND");
  const candidates = await candidateOrdersFor(reply);
  const allowed = new Set(candidates.map((order) => order.id));
  const rules = loadRules();
  const accepted: { orderId: string; driverName: string; driverPhone: string; licensePlate: string; rawLicensePlate: string; vehicleCategory?: string; vehicleModel: string }[] = [];
  const errors: { orderId: string; message: string }[] = [];
  for (const record of input.records) {
    if (!allowed.has(record.orderId)) { errors.push({ orderId: record.orderId, message: "订单不属于当天候选范围，不能写入。" }); continue; }
    const current = await db.order.findUnique({ where: { id: record.orderId }, select: { status: true } });
    if (current?.status === "CANCELLED") { errors.push({ orderId: record.orderId, message: "订单已取消，不能写入司机资料。" }); continue; }
    const phone = normalizeThailandPhone(record.driverPhone, rules);
    const vehicle = normalizeVehicleModel(record.vehicleModel, rules);
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
    await tx.driverDetailConfirmation.createMany({ data: accepted.map((record) => ({ orderId: record.orderId, fleetReplyId: replyId, extractionId: input.extractionId || null, finalDriverName: record.driverName, finalPhone: record.driverPhone, finalPlate: record.licensePlate, finalVehicleModel: record.vehicleModel, confirmedBy: "运营人员", rulesVersion: rules.rules_version })) });
    await tx.activityLog.createMany({ data: accepted.map((record) => ({ orderId: record.orderId, action: "确认车队回传资料", actor: "运营人员", metadata: `车队回复：${replyId}；规则版本：${rules.rules_version}` })) });
  });
  return { valid: true, errors: [], confirmed: accepted.length };
}
