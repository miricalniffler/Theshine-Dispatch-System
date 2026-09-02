import { Prisma, type CustomerNotification, type DriverDetail, type Order } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { isQwenConfigured, qwenJson } from "@/features/assist/qwen";
import { activeAirportGuideCandidates } from "@/features/airport-guides/service";
import { recognizeAirportForOrder, type AirportRecognition } from "@/features/airport-guides/matcher";
import { airportGuidePublicUrl } from "@/features/airport-guides/storage";

export const CUSTOMER_NOTIFICATION_TYPES = {
  FIRST_CONTACT: "FIRST_CONTACT",
  DRIVER_INFO: "DRIVER_INFO",
  DRIVER_INFO_UPDATE: "DRIVER_INFO_UPDATE",
} as const;

type NotificationType = (typeof CUSTOMER_NOTIFICATION_TYPES)[keyof typeof CUSTOMER_NOTIFICATION_TYPES];
type OrderWithDetails = Order & { driverDetail: DriverDetail | null };

export type CommunicationExceptionCode =
  | "MISSING_CUSTOMER_PHONE"
  | "AIRPORT_GUIDE_MISSING"
  | "AIRPORT_UNRESOLVED"
  | "CUSTOMER_REPLY_REVIEW"
  | "CUSTOMER_ORDER_DISCREPANCY"
  | "UNUSUAL_LUGGAGE"
  | "VEHICLE_CAPACITY_RISK"
  | "VEHICLE_CAPACITY_RULE_MISSING"
  | "DRIVER_NOTIFICATION_INCOMPLETE";

const exceptionLabels: Record<CommunicationExceptionCode, string> = {
  MISSING_CUSTOMER_PHONE: "缺少可联系的客人电话",
  AIRPORT_GUIDE_MISSING: "机场已识别，但缺少有效机场指引",
  AIRPORT_UNRESOLVED: "上车地址像机场，但无法确定具体机场",
  CUSTOMER_REPLY_REVIEW: "客人回复需要人工查看",
  CUSTOMER_ORDER_DISCREPANCY: "客人说订单信息可能有误",
  UNUSUAL_LUGGAGE: "行李数量明显偏多，请核实",
  VEHICLE_CAPACITY_RISK: "行李可能超出已安排车型的承载范围",
  VEHICLE_CAPACITY_RULE_MISSING: "已收集行李信息，但该车型尚未配置承载规则",
  DRIVER_NOTIFICATION_INCOMPLETE: "i’way 已正式回传，但司机资料不完整，无法生成客人通知",
};

export function normalizeCustomerPhone(phone: string | null | undefined) {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (/^\+\d{8,15}$/.test(trimmed.replace(/[\s()-]/g, ""))) return digits;
  if (/^00\d{8,15}$/.test(trimmed.replace(/[\s()-]/g, ""))) return digits.slice(2);
  return null;
}

function vehicleKey(value: string | null | undefined) {
  return (value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function passengerCount(order: Order) { return Math.max(0, order.adults) + Math.max(0, order.children); }
function bangkokDateTime(value: Date) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(value); }

function firstContactText(order: Order, guide?: { airportName: string; guideText: string; terminal?: string | null }) {
  const people = passengerCount(order);
  const flight = order.flightNumber?.trim() ? `\nFlight: ${order.flightNumber.trim()}` : "";
  const guideText = guide ? `\n\nAirport pickup guide — ${guide.airportName}${guide.terminal ? ` (${guide.terminal})` : ""}:\n${guide.guideText}` : "";
  return `Hello ${order.passengerName || "there"},\n\nWe are the local transport provider for your i’way transfer. Please kindly confirm the following service details:\nDate & time: ${bangkokDateTime(order.pickupDateTime)}\nPickup: ${order.pickupAddress}\nDestination: ${order.dropoffAddress}\nPassengers: ${people}${flight}\n\nPlease also tell us how many large suitcases, carry-on bags, strollers, or other bulky items you will bring. Thank you!${guideText}`;
}

function driverSnapshot(order: OrderWithDetails) {
  const driver = order.driverDetail;
  return {
    driverName: driver?.confirmedDriverName?.trim() || null,
    driverPhone: driver?.normalizedDriverPhone?.trim() || null,
    vehicleModel: driver?.confirmedVehicleModel?.trim() || null,
    licensePlate: driver?.licensePlate?.trim() || null,
  };
}

function driverComplete(snapshot: ReturnType<typeof driverSnapshot>) {
  return Boolean(snapshot.driverName && snapshot.driverPhone && snapshot.vehicleModel && snapshot.licensePlate);
}

function driverText(order: OrderWithDetails, snapshot: ReturnType<typeof driverSnapshot>, isUpdate: boolean) {
  const lead = isUpdate ? "Your confirmed transfer driver/vehicle information has been updated:" : "Your confirmed transfer driver/vehicle information is ready:";
  return `Hello ${order.passengerName || "there"},\n\n${lead}\nDriver: ${snapshot.driverName}\nPhone: ${snapshot.driverPhone}\nVehicle: ${snapshot.vehicleModel}\nLicense plate: ${snapshot.licensePlate}\n\nPlease use the latest information above. Thank you!`;
}

async function settingEnabled(region: string) {
  const row = await db.regionNotificationSetting.findUnique({ where: { region } });
  return row?.customerWhatsAppEnabled === true;
}

async function upsertException(orderId: string, exceptionType: CommunicationExceptionCode, details: Prisma.InputJsonValue, severity = "WARNING") {
  const idempotencyKey = `customer-exception:${orderId}:${exceptionType}`;
  return db.customerCommunicationException.upsert({
    where: { idempotencyKey },
    create: { orderId, exceptionType, severity, status: "OPEN", idempotencyKey, details },
    update: { severity, status: "OPEN", resolvedAt: null, details },
  });
}

async function resolveException(orderId: string, exceptionType: CommunicationExceptionCode) {
  return db.customerCommunicationException.updateMany({ where: { orderId, exceptionType, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date() } });
}

async function guideForRecognition(recognition: AirportRecognition) {
  if (recognition.kind !== "AIRPORT_PICKUP_MATCHED") return null;
  const guide = await db.airportGuide.findUnique({ where: { id: recognition.guideId }, include: { images: { orderBy: { sortOrder: "asc" } } } });
  if (!guide?.isActive) return null;
  return {
    airportName: guide.airportName,
    terminal: guide.terminal,
    guideText: guide.guideText,
    images: guide.images.map((image) => ({ id: image.id, url: airportGuidePublicUrl(image.storageBucket, image.storagePath), filename: image.originalFilename, mimeType: image.mimeType })),
  };
}

async function firstContactContext(order: OrderWithDetails) {
  const regionEnabled = await settingEnabled(order.city);
  if (!regionEnabled) return { eligible: false, reason: "该运营区域的客人通知已关闭。" as const, recognition: null, guide: null, phone: null };
  const phone = normalizeCustomerPhone(order.passengerPhone);
  const recognition = recognizeAirportForOrder({ pickupAddress: order.pickupAddress, dropoffAddress: order.dropoffAddress, guides: await activeAirportGuideCandidates() });
  const guide = await guideForRecognition(recognition);
  if (!phone) return { eligible: false, reason: "缺少有效的国际客人电话。" as const, recognition, guide, phone: null };
  return { eligible: true, reason: null, recognition, guide, phone };
}

function recognitionWarnings(recognition: AirportRecognition | null) {
  if (!recognition) return [];
  if (recognition.kind === "AIRPORT_PICKUP_GUIDE_MISSING") return ["已识别为机场接机，但没有有效指引；核心首联仍可生成。"];
  if (recognition.kind === "AIRPORT_LIKE_UNRESOLVED") return ["上车地址像机场，但无法确定具体机场；核心首联仍可生成。"];
  return [];
}

export async function previewFirstContact(orderId: string, oneOffText?: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { driverDetail: true } });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const context = await firstContactContext(order);
  return {
    orderId,
    orderNo: order.platformOrderNumber,
    eligible: context.eligible,
    reason: context.reason,
    warnings: recognitionWarnings(context.recognition),
    recognition: context.recognition,
    guide: context.guide,
    message: context.eligible ? (oneOffText?.trim() || firstContactText(order, context.guide || undefined)) : null,
  };
}

export async function previewFirstContacts(orderIds: string[]) {
  const uniqueIds = [...new Set(orderIds)].slice(0, 100);
  return Promise.all(uniqueIds.map((orderId) => previewFirstContact(orderId)));
}

async function recordRecognitionExceptions(order: OrderWithDetails, recognition: AirportRecognition) {
  if (recognition.kind === "AIRPORT_PICKUP_GUIDE_MISSING") await upsertException(order.id, "AIRPORT_GUIDE_MISSING", { airportName: recognition.airportName, matchedBy: recognition.matchedBy });
  else if (recognition.kind === "AIRPORT_LIKE_UNRESOLVED") await upsertException(order.id, "AIRPORT_UNRESOLVED", { reason: recognition.reason });
}

/** Creates an internal outbox record only. No customer message leaves this application here. */
export async function prepareFirstContact(orderId: string, options?: { oneOffText?: string; regenerate?: boolean }) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { driverDetail: true } });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const context = await firstContactContext(order);
  if (!context.eligible || !context.phone) {
    if (context.reason?.includes("电话")) await upsertException(order.id, "MISSING_CUSTOMER_PHONE", { passengerPhone: order.passengerPhone });
    return { created: false, eligible: false, reason: context.reason, notification: null };
  }
  if (context.recognition) await recordRecognitionExceptions(order, context.recognition);
  const idempotencyKey = `customer:first-contact:${order.id}`;
  const message = options?.oneOffText?.trim() || firstContactText(order, context.guide || undefined);
  const existing = await db.customerNotification.findUnique({ where: { idempotencyKey } });
  if (existing && !options?.regenerate) return { created: false, eligible: true, reason: null, notification: existing };
  const templateSnapshot: Prisma.InputJsonValue = { transport: "INTERNAL_PENDING", template: "first_contact_v1", region: order.city, oneOffOverride: Boolean(options?.oneOffText?.trim()), generatedAt: new Date().toISOString() };
  const airportGuideSnapshot: Prisma.InputJsonValue | undefined = context.guide ? { airportName: context.guide.airportName, terminal: context.guide.terminal, guideText: context.guide.guideText, images: context.guide.images } : undefined;
  const notification = await db.customerNotification.upsert({
    where: { idempotencyKey },
    create: { orderId: order.id, notificationType: CUSTOMER_NOTIFICATION_TYPES.FIRST_CONTACT, recipientPhone: context.phone, status: "PENDING", idempotencyKey, contentSnapshot: { text: message }, templateSnapshot, airportGuideSnapshot },
    // An operator's explicit regenerate replaces the unsent internal draft;
    // a concurrent normal click leaves the existing idempotent draft intact.
    update: options?.regenerate ? { recipientPhone: context.phone, status: "PENDING", contentSnapshot: { text: message }, templateSnapshot, airportGuideSnapshot, lastError: null, failedAt: null } : {},
  });
  await db.activityLog.create({ data: { orderId: order.id, action: "已生成客人首联待发送内容", actor: "运营人员", metadata: "仅内部待发送记录，尚未调用 WhatsApp。" } });
  return { created: !existing, eligible: true, reason: null, notification };
}

export async function prepareFirstContacts(orderIds: string[]) {
  const previews = await previewFirstContacts(orderIds);
  const selected = previews.filter((preview) => preview.eligible);
  const results = await Promise.all(selected.map((preview) => prepareFirstContact(preview.orderId)));
  return { previews, prepared: results.filter((result) => result.eligible).length, newlyCreated: results.filter((result) => result.created).length };
}

export async function prepareDriverNotificationForOrder(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { driverDetail: true } });
  if (!order || !(await settingEnabled(order.city))) return { skipped: true, reason: "REGION_DISABLED" };
  const phone = normalizeCustomerPhone(order.passengerPhone);
  if (!phone) { await upsertException(order.id, "MISSING_CUSTOMER_PHONE", { passengerPhone: order.passengerPhone }); return { skipped: true, reason: "MISSING_PHONE" }; }
  const snapshot = driverSnapshot(order);
  if (!driverComplete(snapshot)) { await upsertException(order.id, "DRIVER_NOTIFICATION_INCOMPLETE", { missing: Object.entries(snapshot).filter(([, value]) => !value).map(([key]) => key) }, "HIGH"); return { skipped: true, reason: "INCOMPLETE_DRIVER" }; }
  const previous = await db.customerNotification.findFirst({ where: { orderId, notificationType: { in: [CUSTOMER_NOTIFICATION_TYPES.DRIVER_INFO, CUSTOMER_NOTIFICATION_TYPES.DRIVER_INFO_UPDATE] } }, orderBy: { createdAt: "desc" } });
  const previousSnapshot = previous?.driverVehicleSnapshot as Record<string, unknown> | null;
  if (previousSnapshot && JSON.stringify(previousSnapshot) === JSON.stringify(snapshot)) return { skipped: true, reason: "UNCHANGED_DRIVER" };
  const type: NotificationType = previous ? CUSTOMER_NOTIFICATION_TYPES.DRIVER_INFO_UPDATE : CUSTOMER_NOTIFICATION_TYPES.DRIVER_INFO;
  const snapshotKey = Buffer.from(JSON.stringify(snapshot)).toString("base64url");
  const idempotencyKey = `customer:driver:${order.id}:${snapshotKey}`;
  const existing = await db.customerNotification.findUnique({ where: { idempotencyKey } });
  if (existing) return { skipped: true, reason: "ALREADY_PREPARED", notification: existing };
  const notification = await db.customerNotification.upsert({ where: { idempotencyKey }, create: { orderId, notificationType: type, recipientPhone: phone, status: "PENDING", idempotencyKey, contentSnapshot: { text: driverText(order, snapshot, type === CUSTOMER_NOTIFICATION_TYPES.DRIVER_INFO_UPDATE) }, templateSnapshot: { transport: "INTERNAL_PENDING", template: type === CUSTOMER_NOTIFICATION_TYPES.DRIVER_INFO ? "driver_info_v1" : "driver_info_update_v1", generatedAt: new Date().toISOString() }, driverVehicleSnapshot: snapshot }, update: {} });
  await resolveException(order.id, "DRIVER_NOTIFICATION_INCOMPLETE");
  await db.activityLog.create({ data: { orderId, action: type === CUSTOMER_NOTIFICATION_TYPES.DRIVER_INFO ? "已生成司机资料客人通知" : "已生成司机资料更新客人通知", actor: "系统", metadata: "仅内部待发送记录，尚未调用 WhatsApp。" } });
  return { skipped: false, notification };
}

const qwenReplySchema = z.object({
  confirmation: z.enum(["CONFIRMED", "NOT_CONFIRMED", "UNKNOWN"]).default("UNKNOWN"),
  largeSuitcases: z.number().int().min(0).nullable().optional(),
  carryOnBags: z.number().int().min(0).nullable().optional(),
  strollers: z.number().int().min(0).nullable().optional(),
  bulkyItems: z.string().max(500).nullable().optional(),
  reportsDiscrepancy: z.boolean().default(false),
  discrepancyFields: z.array(z.enum(["date", "time", "flight", "passengers", "pickup", "dropoff", "other"])).max(7).default([]),
  needsReview: z.boolean().default(false),
});
type ReplyResult = z.infer<typeof qwenReplySchema> & { parser: "RULE" | "QWEN" | "MANUAL_REVIEW" };

export function parseSimpleReply(rawText: string): ReplyResult | null {
  const text = rawText.trim();
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, " ");
  const confirmation = /\b(yes|correct|confirmed|ok|okay|all correct|все верно|да)\b/i.test(normalized) ? "CONFIRMED" as const : "UNKNOWN" as const;
  const large = normalized.match(/\b(\d{1,2})\s*(?:large\s*)?(?:suitcases?|luggage|bags?)\b/i)?.[1];
  const carryOn = normalized.match(/\b(\d{1,2})\s*(?:carry[- ]?ons?|hand bags?|small bags?)\b/i)?.[1];
  const strollers = normalized.match(/\b(\d{1,2})\s*(?:strollers?|pushchairs?)\b/i)?.[1];
  const discrepancy = /\b(wrong|change|changed|different|not correct|incorrect|instead|ошибка|измен)/i.test(normalized);
  if (confirmation === "UNKNOWN" && !large && !carryOn && !strollers && !discrepancy) return null;
  return { confirmation, largeSuitcases: large ? Number(large) : null, carryOnBags: carryOn ? Number(carryOn) : null, strollers: strollers ? Number(strollers) : null, bulkyItems: null, reportsDiscrepancy: discrepancy, discrepancyFields: discrepancy ? ["other"] : [], needsReview: discrepancy, parser: "RULE" };
}

async function understandReply(rawText: string): Promise<ReplyResult> {
  const simple = parseSimpleReply(rawText);
  if (simple) return simple;
  if (!isQwenConfigured()) return { confirmation: "UNKNOWN", reportsDiscrepancy: false, discrepancyFields: [], needsReview: true, parser: "MANUAL_REVIEW" };
  try {
    const parsed = qwenReplySchema.parse(await qwenJson<unknown>([
      { role: "system", content: "You only extract structured facts from a passenger transport reply. Return JSON only. Never write a reply, never change an order, never guess. Set needsReview=true when uncertain." },
      { role: "user", content: rawText },
    ], "qwen-flash"));
    return { ...parsed, parser: "QWEN" };
  } catch { return { confirmation: "UNKNOWN", reportsDiscrepancy: false, discrepancyFields: [], needsReview: true, parser: "MANUAL_REVIEW" }; }
}

async function evaluateLuggageRisks(order: OrderWithDetails, result: ReplyResult) {
  const large = result.largeSuitcases ?? order.customerLargeLuggageCount;
  if (large === null || large === undefined) return;
  const people = passengerCount(order);
  if (people > 0 && large > people * 2) await upsertException(order.id, "UNUSUAL_LUGGAGE", { passengers: people, largeSuitcases: large }, "HIGH");
  else await resolveException(order.id, "UNUSUAL_LUGGAGE");
  const model = order.driverDetail?.confirmedVehicleModel;
  if (!model) return;
  const rule = await db.vehicleCapacityRule.findFirst({ where: { isActive: true, normalizedVehicleModel: vehicleKey(model) } });
  if (!rule) { await upsertException(order.id, "VEHICLE_CAPACITY_RULE_MISSING", { vehicleModel: model, largeSuitcases: large }); return; }
  const exceedsPeople = rule.maxPassengers !== null && people > rule.maxPassengers;
  const exceedsLuggage = rule.warningLargeLuggage !== null && large > rule.warningLargeLuggage;
  if (exceedsPeople || exceedsLuggage) await upsertException(order.id, "VEHICLE_CAPACITY_RISK", { vehicleModel: model, passengers: people, largeSuitcases: large, maxPassengers: rule.maxPassengers, warningLargeLuggage: rule.warningLargeLuggage }, "HIGH");
  else await resolveException(order.id, "VEHICLE_CAPACITY_RISK");
  await resolveException(order.id, "VEHICLE_CAPACITY_RULE_MISSING");
}

/** Internal/manual ingestion seam. A future verified Meta webhook can call this same service. */
export async function ingestCustomerReply(input: { orderId: string; rawText: string; senderPhone?: string; providerMessageId?: string }) {
  const order = await db.order.findUnique({ where: { id: input.orderId }, include: { driverDetail: true } });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const rawText = input.rawText.trim();
  if (!rawText) throw new Error("EMPTY_REPLY");
  const result = await understandReply(rawText);
  const message = await db.customerInboundMessage.create({ data: { orderId: order.id, senderPhone: normalizeCustomerPhone(input.senderPhone || order.passengerPhone) || input.senderPhone || order.passengerPhone, providerMessageId: input.providerMessageId || null, rawText, parseStatus: result.parser === "RULE" ? "RULE_PARSED" : result.parser === "QWEN" ? "AI_PARSED" : "MANUAL_REVIEW", parsedSnapshot: result } });
  const update: Prisma.OrderUpdateInput = { customerLuggageUpdatedAt: new Date() };
  if (result.confirmation === "CONFIRMED") { update.customerConfirmationStatus = "CONFIRMED"; update.customerConfirmedAt = new Date(); }
  if (result.largeSuitcases !== null && result.largeSuitcases !== undefined) update.customerLargeLuggageCount = result.largeSuitcases;
  if (result.carryOnBags !== null && result.carryOnBags !== undefined) update.customerCarryOnCount = result.carryOnBags;
  if (result.strollers !== null && result.strollers !== undefined) update.customerStrollerCount = result.strollers;
  if (result.bulkyItems !== null && result.bulkyItems !== undefined) update.customerBulkyItems = result.bulkyItems;
  const updatedOrder = await db.order.update({ where: { id: order.id }, data: update, include: { driverDetail: true } });
  if (result.reportsDiscrepancy) await upsertException(order.id, "CUSTOMER_ORDER_DISCREPANCY", { rawText, fields: result.discrepancyFields }, "HIGH");
  if (result.needsReview || result.confirmation === "UNKNOWN" && !result.reportsDiscrepancy) await upsertException(order.id, "CUSTOMER_REPLY_REVIEW", { rawText, parser: result.parser });
  else await resolveException(order.id, "CUSTOMER_REPLY_REVIEW");
  await evaluateLuggageRisks(updatedOrder, result);
  await db.activityLog.create({ data: { orderId: order.id, action: "已记录客人回复并完成内部理解", actor: "系统", metadata: `解析方式：${result.parser}；未向客人自动回复，也未修改原始订单。` } });
  return { message, result, order: updatedOrder };
}

export async function getCustomerCommunication(orderId: string) {
  const [notifications, replies, exceptions] = await Promise.all([
    db.customerNotification.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } }),
    db.customerInboundMessage.findMany({ where: { orderId }, orderBy: { receivedAt: "desc" } }),
    db.customerCommunicationException.findMany({ where: { orderId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
  ]);
  return { notifications, replies, exceptions: exceptions.map((item) => ({ ...item, label: exceptionLabels[item.exceptionType as CommunicationExceptionCode] || item.exceptionType })) };
}

export async function listOpenCustomerCommunicationExceptions(orderIds?: string[]) {
  return db.customerCommunicationException.findMany({ where: { status: "OPEN", ...(orderIds?.length ? { orderId: { in: orderIds } } : {}) }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }] });
}

export const capacityRuleInputSchema = z.object({ vehicleModel: z.string().trim().min(2).max(160), maxPassengers: z.number().int().min(1).max(100).nullable().optional(), normalLargeLuggage: z.number().int().min(0).max(100).nullable().optional(), warningLargeLuggage: z.number().int().min(0).max(100).nullable().optional(), note: z.string().trim().max(1000).nullable().optional(), isActive: z.boolean().default(true) });

export async function listVehicleCapacityRules() { return db.vehicleCapacityRule.findMany({ orderBy: [{ isActive: "desc" }, { vehicleModel: "asc" }] }); }
export async function saveVehicleCapacityRule(input: z.infer<typeof capacityRuleInputSchema>) {
  const vehicleModel = input.vehicleModel.trim(); const normalizedVehicleModel = vehicleKey(vehicleModel);
  return db.vehicleCapacityRule.upsert({ where: { normalizedVehicleModel }, create: { ...input, vehicleModel, normalizedVehicleModel, note: input.note?.trim() || null }, update: { ...input, vehicleModel, note: input.note?.trim() || null } });
}
