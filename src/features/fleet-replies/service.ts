import { z } from "zod";
import { db } from "@/lib/db";
import { loadRules } from "@/lib/rules/load-rules";
import { normalizeThailandPhone, normalizeVehicleModel } from "@/lib/rules/engine";
import { saveDriverDetails } from "@/features/iway/service";

const confidenceSchema = z.enum(["high", "medium", "low"]);
const fieldSchema = z.object({ value: z.string().nullable(), confidence: confidenceSchema, evidence: z.string().min(1) });
const modelSchema = fieldSchema.extend({ image_ids: z.array(z.string()).optional() });
const analysisSchema = z.object({
  translation_zh: z.string(),
  records: z.array(z.object({
    source_index: z.number().int().positive(),
    order_match: z.object({ platform_order_number: z.string().nullable(), confidence: confidenceSchema, evidence: z.string().min(1) }),
    driver_name: fieldSchema.extend({ original_value: z.string().nullable().optional() }),
    driver_phone: fieldSchema,
    license_plate: fieldSchema,
    vehicle_category: fieldSchema,
    vehicle_model: modelSchema,
    needs_review: z.boolean(),
    review_reasons: z.array(z.string()),
  })),
  unmatched_items: z.array(z.object({ source_type: z.enum(["text", "image"]), source_id: z.string(), reason: z.string() })),
});

type Analysis = z.infer<typeof analysisSchema>;
type CandidateOrder = { id: string; orderNo: string; passengerName: string; pickup: string; route: string; city: string; fleetName: string };

function normalizedOrderNo(value: string) { return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase(); }
function parseIds(raw: string | null) { try { return raw ? z.array(z.string()).parse(JSON.parse(raw)) : []; } catch { return []; } }

async function candidateOrdersFor(reply: { dispatchBatchId: string | null; candidateOrderIds: string | null }) {
  const ids = parseIds(reply.candidateOrderIds);
  const orderIds = ids.length ? ids : reply.dispatchBatchId
    ? (await db.dispatchBatch.findUnique({ where: { id: reply.dispatchBatchId }, include: { orders: true } }))?.orders.map((link) => link.orderId) ?? []
    : [];
  const orders = await db.order.findMany({ where: { id: { in: orderIds } }, include: { fleet: true }, orderBy: { pickupDateTime: "asc" } });
  return orders.map((order): CandidateOrder => ({
    id: order.id, orderNo: order.platformOrderNumber, passengerName: order.passengerName,
    pickup: `${order.serviceDate} ${order.pickupDateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}`,
    route: `${order.pickupAddress} → ${order.dropoffAddress}`, city: order.city, fleetName: order.fleet?.name ?? "未分配车队",
  }));
}

export async function listReplyContexts() {
  const batches = await db.dispatchBatch.findMany({
    where: { orders: { some: { order: { status: { in: ["DISPATCHED", "DRIVER_CONFIRMED"] } } } } },
    include: { fleet: true, orders: { include: { order: true } } }, orderBy: { createdAt: "desc" }, take: 30,
  });
  return batches.map((batch) => ({ id: batch.id, city: batch.city, fleetName: batch.fleet.name, serviceDate: batch.serviceDate,
    orderIds: batch.orders.map((link) => link.orderId),
    orders: batch.orders.map((link) => ({ id: link.order.id, orderNo: link.order.platformOrderNumber, passengerName: link.order.passengerName })),
  }));
}

export async function createFleetReply(input: { dispatchBatchId?: string; orderIds?: string[]; rawText?: string; images?: { dataUrl: string; filename?: string; mimeType?: string }[] }) {
  const rawText = input.rawText?.trim() ?? "";
  const orderIds = [...new Set(input.orderIds ?? [])];
  if (!input.dispatchBatchId && !orderIds.length) throw new Error("CONTEXT_REQUIRED");
  if (!rawText && !(input.images?.length)) throw new Error("SOURCE_REQUIRED");
  const reply = await db.fleetReply.create({ data: {
    dispatchBatchId: input.dispatchBatchId || null, candidateOrderIds: orderIds.length ? JSON.stringify(orderIds) : null, rawText, createdBy: "运营人员",
    images: { create: (input.images ?? []).map((image) => ({ storagePath: image.dataUrl, originalFilename: image.filename || null, mimeType: image.mimeType || "image/*" })) },
  }, include: { images: true } });
  return { id: reply.id, rawText: reply.rawText, imageCount: reply.images.length };
}

function promptFor(orders: CandidateOrder[], rules: ReturnType<typeof loadRules>) {
  return `你是接送机车队回复识别助手。只从给出的车队原文、图片与候选订单中提取资料；未知值必须为 null，禁止猜测。输出必须是严格 JSON，不要 Markdown。\n\n规则：订单号只能匹配候选订单；若非精确订单号匹配、或置信度不是 high，needs_review 必须为 true。每个订单独立，绝不把一条资料复制到多笔订单。Van/Minibus/Sedan/Standard/Minivan 只能作为 vehicle_category，不能作为 vehicle_model。车型别名映射：${JSON.stringify(rules.transforms.vehicle_aliases)}。禁止作为回传车型：${JSON.stringify(rules.transforms.generic_vehicle_labels_not_allowed_for_return)}。完整翻译为中文且保留全部原意。\n\n输出 JSON 结构：{translation_zh:string,records:[{source_index:number,order_match:{platform_order_number:string|null,confidence:"high"|"medium"|"low",evidence:string},driver_name:{value:string|null,original_value?:string|null,confidence:"high"|"medium"|"low",evidence:string},driver_phone:{value:string|null,confidence:"high"|"medium"|"low",evidence:string},license_plate:{value:string|null,confidence:"high"|"medium"|"low",evidence:string},vehicle_category:{value:string|null,confidence:"high"|"medium"|"low",evidence:string},vehicle_model:{value:string|null,confidence:"high"|"medium"|"low",evidence:string,image_ids?:string[]},needs_review:boolean,review_reasons:string[]}],unmatched_items:[{source_type:"text"|"image",source_id:string,reason:string}]}.\n\n候选订单：${JSON.stringify(orders)}`;
}

function validateMatches(result: Analysis, orders: CandidateOrder[]) {
  const allowed = new Set(orders.map((order) => normalizedOrderNo(order.orderNo)));
  return result.records.map((record) => {
    const matched = record.order_match.platform_order_number && allowed.has(normalizedOrderNo(record.order_match.platform_order_number));
    if (matched && record.order_match.confidence === "high") return record;
    return { ...record, order_match: { ...record.order_match, platform_order_number: null }, needs_review: true,
      review_reasons: [...record.review_reasons, "未达到订单号精确匹配，需人工归属"].filter((value, index, values) => values.indexOf(value) === index) };
  });
}

export async function analyzeFleetReply(replyId: string) {
  const reply = await db.fleetReply.findUnique({ where: { id: replyId }, include: { images: true } });
  if (!reply) throw new Error("REPLY_NOT_FOUND");
  const orders = await candidateOrdersFor(reply);
  if (!orders.length) throw new Error("CONTEXT_REQUIRED");
  const rules = loadRules();
  const url = process.env.FLEET_REPLY_AI_URL;
  const apiKey = process.env.FLEET_REPLY_AI_API_KEY;
  if (!url || !apiKey) {
    const extraction = await db.aiExtraction.create({ data: { fleetReplyId: reply.id, provider: "未配置", promptVersion: "fleet-reply-v1", status: "CONFIGURATION_REQUIRED", errorMessage: "尚未配置 FLEET_REPLY_AI_URL 与 FLEET_REPLY_AI_API_KEY。" } });
    return { status: extraction.status, message: extraction.errorMessage, replyId, orders };
  }
  const payload = { prompt: promptFor(orders, rules), rawText: reply.rawText, images: reply.images.map((image) => ({ id: image.id, dataUrl: image.storagePath, mimeType: image.mimeType })), orders };
  let raw = "";
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
    const body = await response.json() as unknown;
    raw = JSON.stringify(body);
    const candidate = typeof body === "object" && body !== null && "result" in body ? (body as { result: unknown }).result : body;
    const parsed = typeof candidate === "string" ? JSON.parse(candidate) : candidate;
    const result = analysisSchema.parse(parsed);
    const secured = { ...result, records: validateMatches(result, orders) };
    const extraction = await db.aiExtraction.create({ data: { fleetReplyId: reply.id, provider: "可配置 AI 服务", modelName: process.env.FLEET_REPLY_AI_MODEL || null, promptVersion: "fleet-reply-v1", rawModelJson: raw, validatedResultJson: JSON.stringify(secured), status: "SUCCEEDED" } });
    return { status: extraction.status, replyId, extractionId: extraction.id, result: secured, orders };
  } catch (error) {
    const message = error instanceof Error ? error.message : "识别服务异常";
    await db.aiExtraction.create({ data: { fleetReplyId: reply.id, provider: "可配置 AI 服务", modelName: process.env.FLEET_REPLY_AI_MODEL || null, promptVersion: "fleet-reply-v1", rawModelJson: raw || null, status: "FAILED", errorMessage: message } });
    return { status: "FAILED", message, replyId, orders };
  }
}

export async function getFleetReply(replyId: string) {
  const reply = await db.fleetReply.findUnique({ where: { id: replyId }, include: { images: true, extractions: { orderBy: { createdAt: "desc" }, take: 1 }, confirmations: { orderBy: { confirmedAt: "desc" } } } });
  if (!reply) throw new Error("REPLY_NOT_FOUND");
  const orders = await candidateOrdersFor(reply);
  const extraction = reply.extractions[0];
  return { id: reply.id, rawText: reply.rawText, images: reply.images.map(({ id, originalFilename, mimeType }) => ({ id, originalFilename, mimeType })), orders, extraction: extraction ? { id: extraction.id, status: extraction.status, message: extraction.errorMessage, result: extraction.validatedResultJson ? JSON.parse(extraction.validatedResultJson) : null } : null, confirmations: reply.confirmations };
}

export async function confirmFleetReply(replyId: string, input: { extractionId?: string; records: { orderId: string; driverName: string; driverPhone: string; licensePlate: string; vehicleModel: string }[] }) {
  const reply = await db.fleetReply.findUnique({ where: { id: replyId } });
  if (!reply) throw new Error("REPLY_NOT_FOUND");
  const candidates = await candidateOrdersFor(reply);
  const allowed = new Set(candidates.map((order) => order.id));
  const rules = loadRules();
  const accepted: { orderId: string; driverName: string; driverPhone: string; licensePlate: string; vehicleModel: string }[] = [];
  const errors: { orderId: string; message: string }[] = [];
  for (const record of input.records) {
    if (!allowed.has(record.orderId)) { errors.push({ orderId: record.orderId, message: "订单不属于本批次，不能写入。" }); continue; }
    const phone = normalizeThailandPhone(record.driverPhone, rules);
    const vehicle = normalizeVehicleModel(record.vehicleModel, rules);
    if (!record.driverName.trim() || !phone || !record.licensePlate.trim() || !vehicle) { errors.push({ orderId: record.orderId, message: "司机姓名、泰国电话、车牌和具体车型都必须填写。" }); continue; }
    if (rules.transforms.generic_vehicle_labels_not_allowed_for_return.some((item) => item.toLowerCase() === vehicle.toLowerCase())) { errors.push({ orderId: record.orderId, message: "i’way 回传需要具体车型，不能只填 Van、Minibus、Sedan 等大类。" }); continue; }
    accepted.push({ ...record, driverName: record.driverName.trim(), driverPhone: phone, licensePlate: record.licensePlate.trim(), vehicleModel: vehicle });
  }
  if (errors.length) return { valid: false, errors, confirmed: 0 };
  for (const record of accepted) {
    await saveDriverDetails(record.orderId, { rawReply: reply.rawText, confirmedDriverName: record.driverName, rawDriverPhone: record.driverPhone, confirmedVehicleModel: record.vehicleModel, licensePlate: record.licensePlate });
  }
  await db.$transaction(async (tx) => {
    await tx.driverDetailConfirmation.createMany({ data: accepted.map((record) => ({ orderId: record.orderId, fleetReplyId: replyId, extractionId: input.extractionId || null, finalDriverName: record.driverName, finalPhone: record.driverPhone, finalPlate: record.licensePlate, finalVehicleModel: record.vehicleModel, confirmedBy: "运营人员", rulesVersion: rules.rules_version })) });
    await tx.activityLog.createMany({ data: accepted.map((record) => ({ orderId: record.orderId, action: "确认车队回传识别资料", actor: "运营人员", metadata: `车队回复：${replyId}；规则版本：${rules.rules_version}` })) });
  });
  return { valid: true, errors: [], confirmed: accepted.length };
}
