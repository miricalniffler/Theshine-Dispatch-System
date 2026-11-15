import { Prisma, type Order } from "@prisma/client";
import { db } from "@/lib/db";
import type { GmailIwayMessage } from "./gmail-iway-sync";
import { classifyLifecycleNotice, lifecycleFields, lifecycleMailType } from "./iway-lifecycle-parser";

const connector = "gmail-iway";
const activeReviewAction = "LIFECYCLE_REVIEW_PENDING";

export type MailDifference = { field: string; before: string; proposed: string };
export type MailReview = { reason: string; orderNumber: string | null; kind: string; differences: MailDifference[]; fields: ReturnType<typeof lifecycleFields>; subject?: string; mailType?: string };
export type LifecycleResult = "amended" | "cancelled" | "cancelledReview" | "review" | "skipped";
type BusinessState = Record<string, string | number | null>;
type AmendmentPlan = { updates: Record<string, string | number | null>; differences: MailDifference[]; reason?: string };

const snapshotFields = ["city", "fleetId", "serviceDate", "pickupDateTime", "pickupAddress", "dropoffAddress", "passengerName", "passengerPhone", "flightNumber", "platformVehicleType", "seatCount", "adults", "children", "luggage", "childSeatLine", "meetGreetLine", "otherNotes", "status"] as const;
const directFields: Record<string, keyof Order> = { "Vehicle class": "platformVehicleType", "Flight number": "flightNumber", "Greeting sign": "meetGreetLine", "Additional remarks": "otherNotes" };

function compact(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase(); }
function optional(value: string) { return /^(?:|none|n\/?a|-|—)$/i.test(value.trim()) ? null : value.trim(); }
function toState(order: Order): BusinessState { return Object.fromEntries(snapshotFields.map((field) => { const value = order[field]; return [field, value instanceof Date ? value.toISOString() : value ?? null]; })); }
function hasDriverOrDispatch(order: Order & { driverDetail?: unknown }) { return Boolean(order.driverDetail) || ["DISPATCHED", "DRIVER_CONFIRMED", "RETURNED"].includes(order.status); }
function reviewFor(message: GmailIwayMessage, reason: string, plan?: AmendmentPlan): MailReview { const notice = classifyLifecycleNotice(message.subject, message.text, message.fields)!; return { reason, orderNumber: notice.orderNumber, kind: notice.kind, subject: message.subject, mailType: lifecycleMailType(message.subject), differences: plan?.differences ?? [], fields: lifecycleFields(message.fields) }; }

/** Applies only table cells whose previous, struck-through value matches the current order. */
export function verifiedAmendmentPlan(order: Order, message: GmailIwayMessage): AmendmentPlan {
  const changed = lifecycleFields(message.fields).filter((field) => field.previous.length > 0);
  if (!changed.length) return { updates: {}, differences: [], reason: "AMENDMENT_NO_VERIFIED_FIELD_CHANGE" };
  const updates: Record<string, string | number | null> = {}; const unsupported: string[] = [];
  for (const field of changed) {
    const target = directFields[field.label];
    if (!target) { unsupported.push(field.label); continue; }
    const proposed = optional(field.current); const old = order[target]; const oldText = old instanceof Date ? old.toISOString() : String(old ?? "");
    const priorMatches = field.previous.some((value) => compact(value) === compact(oldText));
    if (!priorMatches && compact(proposed) !== compact(oldText)) return { updates: {}, differences: [], reason: `AMENDMENT_CONFLICT_${target}` };
    if (compact(proposed) !== compact(oldText)) updates[target] = proposed;
  }
  if (unsupported.length) return { updates: {}, differences: [], reason: `AMENDMENT_UNSUPPORTED_CHANGED_FIELDS:${unsupported.join(",")}` };
  const differences = Object.entries(updates).map(([field, proposed]) => ({ field, before: String(order[field as keyof Order] ?? ""), proposed: String(proposed ?? "") }));
  return { updates, differences };
}

// Opening the queue is read-only: it never retries or changes an order.
export function previewLifecycleReview(message: GmailIwayMessage, stored: MailReview, order: Order | null): MailReview {
  const notice = classifyLifecycleNotice(message.subject, message.text, message.fields);
  if (!notice || stored.reason === "CANCELLED_NOTIFY_FLEET") return stored;
  if (!notice.orderNumber) return reviewFor(message, notice.reason);
  if (!order) return reviewFor(message, notice.kind === "cancel" ? "CANCEL_ORIGINAL_NOT_FOUND" : "AMEND_ORIGINAL_NOT_FOUND");
  if (notice.kind !== "amend") return reviewFor(message, stored.reason);
  const plan = verifiedAmendmentPlan(order, message);
  return reviewFor(message, plan.reason ?? stored.reason, plan);
}

async function writeSnapshot(tx: Prisma.TransactionClient, order: Order, kind: string, sourceMessageExternalId: string | null, sourceReceivedAt: Date, updates: Record<string, unknown>) {
  const beforeState = toState(order); const afterState = { ...beforeState, ...updates };
  await tx.gmailOrderSnapshot.create({ data: { orderId: order.id, sourceMessageExternalId, kind, beforeState: beforeState as Prisma.InputJsonValue, afterState: afterState as Prisma.InputJsonValue, changedFields: Object.keys(updates) as Prisma.InputJsonValue, sourceReceivedAt } });
}
async function persistSource(tx: Prisma.TransactionClient, message: GmailIwayMessage, orderId: string | null, action: string, review: MailReview) {
  const data = { connector, externalId: message.id, action, sourceText: JSON.stringify({ review, message }), orderId, receivedAt: new Date(message.receivedAt) };
  const known = await tx.importedSourceMessage.findUnique({ where: { connector_externalId: { connector, externalId: message.id } } });
  if (known) await tx.importedSourceMessage.update({ where: { id: known.id }, data }); else await tx.importedSourceMessage.create({ data });
}

/** The caller already checked sender, timestamp and the original activation waterline. */
export async function ingestLifecycle(message: GmailIwayMessage, retryPending = false): Promise<LifecycleResult> {
  const notice = classifyLifecycleNotice(message.subject, message.text, message.fields)!;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gmail-iway:${notice.orderNumber ?? message.id}`}))`;
    const known = await tx.importedSourceMessage.findUnique({ where: { connector_externalId: { connector, externalId: message.id } } });
    if (known && (!retryPending || known.action !== activeReviewAction)) return "skipped";
    if (known && JSON.parse(known.sourceText).review?.reason === "CANCELLED_NOTIFY_FLEET") return "review";
    const initial = notice.orderNumber ? await tx.order.findUnique({ where: { platformOrderNumber: notice.orderNumber }, include: { driverDetail: true } }) : null;
    if (initial) await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${initial.id} FOR UPDATE`;
    const order = initial ? await tx.order.findUniqueOrThrow({ where: { id: initial.id }, include: { driverDetail: true } }) : null;
    const laterMail = order ? await tx.importedSourceMessage.findFirst({ where: { connector, orderId: order.id, receivedAt: { gt: new Date(message.receivedAt) } }, select: { id: true } }) : null;
    if (!order) { await persistSource(tx, message, null, activeReviewAction, reviewFor(message, notice.orderNumber ? (notice.kind === "cancel" ? "CANCEL_ORIGINAL_NOT_FOUND" : "AMEND_ORIGINAL_NOT_FOUND") : notice.reason)); return "review"; }
    if (laterMail) { await persistSource(tx, message, order.id, activeReviewAction, reviewFor(message, "OLDER_THAN_PROCESSED_MAIL")); return "review"; }
    if (order.status === "COMPLETED") { await persistSource(tx, message, order.id, activeReviewAction, reviewFor(message, "COMPLETED_ORDER_REQUIRES_REVIEW")); return "review"; }
    if (notice.kind === "cancel") {
      if (order.status === "CANCELLED") { await persistSource(tx, message, order.id, "ORDER_CANCELLED_ALREADY", reviewFor(message, "ALREADY_CANCELLED")); return "skipped"; }
      const needsFleetNotice = hasDriverOrDispatch(order);
      await writeSnapshot(tx, order, "CANCEL", message.id, new Date(message.receivedAt), { status: "CANCELLED" });
      await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
      await tx.activityLog.create({ data: { orderId: order.id, action: "Gmail 邮件同步：订单已取消", actor: "Gmail 同步", metadata: JSON.stringify({ messageId: message.id, reason: "iWay 明确取消通知", previousStatus: order.status, needsFleetNotice }) } });
      const batches = await tx.iwayReturnBatchOrder.findMany({ where: { orderId: order.id }, select: { iwayReturnBatchId: true } });
      if (batches.length) await tx.iwayReturnBatch.updateMany({ where: { id: { in: batches.map((batch) => batch.iwayReturnBatchId) }, confirmedAt: null }, data: { contentSnapshot: "[已失效：订单取消，请重新生成回传]" } });
      const reason = needsFleetNotice ? "CANCELLED_NOTIFY_FLEET" : "CANCELLED_AUTOMATICALLY";
      if (needsFleetNotice) await tx.activityLog.create({ data: { orderId: order.id, action: "新增异常备注", actor: "Gmail 同步", metadata: JSON.stringify({ note: "iWay 已取消：已派车，必须通知车队并核实费用。" }) } });
      await persistSource(tx, message, order.id, needsFleetNotice ? activeReviewAction : "ORDER_CANCELLED", reviewFor(message, reason));
      return needsFleetNotice ? "cancelledReview" : "cancelled";
    }
    if (notice.kind !== "amend") { await persistSource(tx, message, order.id, activeReviewAction, reviewFor(message, notice.reason)); return "review"; }
    if (order.status === "CANCELLED") { await persistSource(tx, message, order.id, activeReviewAction, reviewFor(message, "AMENDMENT_FOR_CANCELLED_ORDER")); return "review"; }
    const plan = verifiedAmendmentPlan(order, message);
    if (plan.reason) { await persistSource(tx, message, order.id, activeReviewAction, reviewFor(message, plan.reason, plan)); return "review"; }
    if (!Object.keys(plan.updates).length) { await persistSource(tx, message, order.id, "ORDER_AMENDMENT_ALREADY_APPLIED", reviewFor(message, "AMENDMENT_ALREADY_APPLIED", plan)); return "skipped"; }
    await writeSnapshot(tx, order, "AMEND", message.id, new Date(message.receivedAt), plan.updates);
    const updated = await tx.order.update({ where: { id: order.id }, data: plan.updates });
    await tx.activityLog.create({ data: { orderId: order.id, action: "Gmail 邮件同步：订单已自动修改", actor: "Gmail 同步", metadata: JSON.stringify({ messageId: message.id, fields: plan.differences, sourceReceivedAt: message.receivedAt }) } });
    await persistSource(tx, message, updated.id, "ORDER_AMENDED", reviewFor(message, "AMENDMENT_APPLIED", plan));
    return "amended";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
