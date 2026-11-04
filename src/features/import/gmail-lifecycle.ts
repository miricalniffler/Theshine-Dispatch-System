import { Prisma, type Order } from "@prisma/client";
import { db } from "@/lib/db";
import type { GmailIwayMessage } from "./gmail-iway-sync";
import { classifyLifecycleNotice, currentLifecycleText, lifecycleFields, lifecycleMailType } from "./iway-lifecycle-parser";
import { parseIwayNewRide } from "./iway-new-ride-parser";
import { zonedLocalDateTimeToUtc } from "./service-timezone";

const connector = "gmail-iway";
export type MailReview = { reason: string; orderNumber: string | null; kind: string; differences: Array<{ field: string; before: string; proposed: string }>; fields: ReturnType<typeof lifecycleFields>; subject?: string; mailType?: string };
// A read-only projection also repairs old pending cards without replaying a
// cancellation or changing an order just because the dashboard was opened.
export function previewLifecycleReview(message: GmailIwayMessage, stored: MailReview, order: Order | null): MailReview {
  const notice = classifyLifecycleNotice(message.subject, message.text, message.fields);
  if (!notice || stored.reason === "CANCELLED_NOTIFY_FLEET") return stored;
  const reason = !notice.orderNumber ? notice.reason : !order ? (lifecycleMailType(message.subject) === "cancel" ? "CANCEL_ORIGINAL_NOT_FOUND" : "AMEND_ORIGINAL_NOT_FOUND") : ["ORDER_NOT_FOUND", "ORDER_NUMBER_MISSING_OR_CONFLICTING", "CANCEL_ORIGINAL_NOT_FOUND", "AMEND_ORIGINAL_NOT_FOUND"].includes(stored.reason) ? notice.reason : stored.reason;
  return { reason, orderNumber: notice.orderNumber, kind: notice.kind, subject: message.subject, mailType: lifecycleMailType(message.subject), differences: order && notice.kind === "amend" ? differences(order, message) : [], fields: lifecycleFields(message.fields) };
}
function differences(order: Order, message: GmailIwayMessage): MailReview["differences"] {
  const text = currentLifecycleText(message.text, message.fields);
  const parsed = parseIwayNewRide(text, { referenceDate: new Date(message.receivedAt) });
  const date = parsed.pickupDateTime && parsed.serviceTimeZone ? zonedLocalDateTimeToUtc(parsed.pickupDateTime, parsed.serviceTimeZone)?.toISOString() : null;
  const values: Record<string, string | number | null> = { pickupDateTime: date || null, pickupAddress: parsed.pickupAddress || null, dropoffAddress: parsed.dropoffAddress || null, passengerName: parsed.passengerName || null, passengerPhone: parsed.passengerPhone || null, platformVehicleType: parsed.platformVehicleType || null };
  // Optional/empty cells are compared only when the table actually supplied
  // them, preventing parser defaults from manufacturing deletions or counts.
  const fields = lifecycleFields(message.fields);
  if (fields.some(f => f.label === "Flight number")) values.flightNumber = parsed.flightNumber;
  if (fields.some(f => f.label === "Greeting sign")) values.meetGreetLine = parsed.meetGreetLine;
  if (fields.some(f => f.label === "Pax")) values.adults = parsed.adults;
  if (fields.some(f => f.label === "Additional remarks")) values.otherNotes = fields.find(f=>f.label === "Additional remarks")!.current;
  return Object.entries(values).flatMap(([field, proposed]) => {
    if (proposed === null) return [];
    const raw = order[field as keyof Order];
    const before = raw instanceof Date ? raw.toISOString() : String(raw ?? "");
    return before.trim() === String(proposed).trim() ? [] : [{ field, before, proposed: String(proposed) }];
  });
}

/** The caller already checked sender, timestamp and the original activation waterline. */
export async function ingestLifecycle(message: GmailIwayMessage, retryPending = false): Promise<"cancelled" | "cancelledReview" | "review" | "skipped"> {
  const notice = classifyLifecycleNotice(message.subject, message.text, message.fields)!;
  return db.$transaction(async tx => {
    // Serializes creation, state transitions and replay checks for this exact
    // platform number across concurrent HTTP retries without adding a schema.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gmail-iway:${notice.orderNumber ?? message.id}`}))`;
    const known = await tx.importedSourceMessage.findUnique({ where: { connector_externalId: { connector, externalId: message.id } } });
    if (known && (!retryPending || known.action !== "LIFECYCLE_REVIEW_PENDING")) return "skipped";
    // Re-parsing must never acknowledge a pending fleet notification.
    if (known && JSON.parse(known.sourceText).review?.reason === "CANCELLED_NOTIFY_FLEET") return "review";
    const order = notice.orderNumber ? await tx.order.findUnique({ where: { platformOrderNumber: notice.orderNumber }, include: { driverDetail: true } }) : null;
    if (order) await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    const current = order ? await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { driverDetail: true } }) : null;
    const latest = current ? await tx.importedSourceMessage.findFirst({ where: { connector, orderId: current.id, receivedAt: { gt: new Date(message.receivedAt) } }, select: { id: true } }) : null;
    let reason = notice.reason;
    let result: "cancelled" | "cancelledReview" | "review" | "skipped" = "review";
    const alreadyCancelled = current?.status === "CANCELLED";
    const safe = notice.kind === "cancel" && current && current.status !== "COMPLETED" && !latest;
    if (safe && !alreadyCancelled) {
      await tx.order.update({ where: { id: current.id }, data: { status: "CANCELLED" } });
      const needsFleetNotice = Boolean(current.driverDetail) || ["DISPATCHED", "DRIVER_CONFIRMED", "RETURNED"].includes(current.status);
      await tx.activityLog.create({ data: { orderId: current.id, action: "Gmail 邮件同步：订单已取消", actor: "Gmail 同步", metadata: JSON.stringify({ messageId: message.id, reason: "iWay 明确取消通知", previousStatus: current.status, needsFleetNotice }) } });
      // Invalidate every outstanding return snapshot permanently. A later
      // restore never makes an old generated return reusable.
      const batches = await tx.iwayReturnBatchOrder.findMany({ where: { orderId: current.id }, select: { iwayReturnBatchId: true } });
      if (batches.length) await tx.iwayReturnBatch.updateMany({ where: { id: { in: batches.map(b=>b.iwayReturnBatchId) }, confirmedAt: null }, data: { contentSnapshot: "[已失效：订单取消，请重新生成回传]" } });
      if (needsFleetNotice) {
        await tx.activityLog.create({ data: { orderId: current.id, action: "新增异常备注", actor: "Gmail 同步", metadata: JSON.stringify({ note: "iWay 已取消：已派车，必须通知车队并核实费用。" }) } });
        reason = "CANCELLED_NOTIFY_FLEET";
        result = "cancelledReview";
      } else result = "cancelled";
    } else if (alreadyCancelled && notice.kind === "cancel") result = "skipped";
    else if (!current) reason = notice.orderNumber ? "ORDER_NOT_FOUND" : notice.reason;
    else if (latest) reason = "OLDER_THAN_PROCESSED_MAIL";
    else if (current.status === "COMPLETED") reason = "COMPLETED_ORDER_REQUIRES_REVIEW";
    const review: MailReview = { reason, orderNumber: notice.orderNumber, kind: notice.kind, subject: message.subject, mailType: lifecycleMailType(message.subject), differences: current && notice.kind === "amend" ? differences(current, message) : [], fields: lifecycleFields(message.fields) };
    const data = { connector, externalId: message.id, action: (result === "review" || result === "cancelledReview") ? "LIFECYCLE_REVIEW_PENDING" : result === "cancelled" ? "ORDER_CANCELLED" : "LIFECYCLE_SKIPPED", sourceText: JSON.stringify({ review, message }), orderId: current?.id, receivedAt: new Date(message.receivedAt) };
    if (known) {
      await tx.importedSourceMessage.update({ where: { id: known.id }, data });
      await tx.activityLog.create({ data: { orderId: current?.id, action: "Gmail 待办重新识别", actor: "运营人员", metadata: JSON.stringify({ messageId: message.id, previousReason: JSON.parse(known.sourceText).review?.reason, result }) } });
    } else await tx.importedSourceMessage.create({ data });
    if (current && (result === "review" || result === "cancelledReview")) await tx.activityLog.create({ data: { orderId: current.id, action: "Gmail 邮件待人工确认", actor: "Gmail 同步", metadata: JSON.stringify({ messageId: message.id, reason, fields: review.differences.map(d=>d.field) }) } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
