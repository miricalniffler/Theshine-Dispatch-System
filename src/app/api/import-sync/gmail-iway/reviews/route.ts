import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";
import { ingestLifecycle, previewLifecycleReview, type MailReview } from "@/features/import/gmail-lifecycle";
import { classifyLifecycleNotice } from "@/features/import/iway-lifecycle-parser";
import type { GmailIwayMessage } from "@/features/import/gmail-iway-sync";

const connector = "gmail-iway";
const openAction = "LIFECYCLE_REVIEW_PENDING";
function teamAuthorised(request: NextRequest) { const expected = process.env.TEAM_ACCESS_TOKEN; return Boolean(expected) && request.cookies.get("iway-team-access")?.value === expected; }

function readableMail(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<GmailIwayMessage>;
  if (typeof message.id !== "string" || typeof message.sender !== "string" || typeof message.subject !== "string" || typeof message.receivedAt !== "string" || typeof message.text !== "string") return null;
  // This internal workbench is team-login protected. The bound only prevents a
  // malformed source record from making the orders dashboard unusable.
  return { id: message.id, sender: message.sender, subject: message.subject, receivedAt: message.receivedAt, text: message.text.slice(0, 40_000), fields: Array.isArray(message.fields) ? message.fields : undefined } satisfies GmailIwayMessage;
}

export async function GET(request: NextRequest) {
  if (!teamAuthorised(request)) return failure("UNAUTHORISED", "需要登录后才能查看 Gmail 异常详情。", undefined, 401);
  const rows = await db.importedSourceMessage.findMany({ where: { connector, action: openAction }, orderBy: { processedAt: "desc" }, take: 100 });
  return success(await Promise.all(rows.map(async (row) => {
    let review: MailReview | null = null; let orderId = row.orderId; let mail: GmailIwayMessage | null = null;
    let order = null as Awaited<ReturnType<typeof db.order.findUnique>>;
    try {
      const source = JSON.parse(row.sourceText) as { review?: MailReview; message?: unknown };
      review = source.review || null; mail = readableMail(source.message);
      if (review && mail) {
        const notice = classifyLifecycleNotice(mail.subject, mail.text, mail.fields);
        order = notice?.orderNumber ? await db.order.findUnique({ where: { platformOrderNumber: notice.orderNumber } }) : null;
        if (review.reason !== "CANCELLED_NOTIFY_FLEET") review = previewLifecycleReview(mail, review, order);
        orderId = order?.id ?? null;
      }
    } catch { /* keep the protected source record but do not expose raw mail */ }
    const orderData = order ? { platformOrderNumber: order.platformOrderNumber, status: order.status, passengerName: order.passengerName, passengerPhone: order.passengerPhone, pickupDateTime: order.pickupDateTime, pickupAddress: order.pickupAddress, dropoffAddress: order.dropoffAddress, platformVehicleType: order.platformVehicleType, flightNumber: order.flightNumber, meetGreetLine: order.meetGreetLine, otherNotes: order.otherNotes } : null;
    return { id: row.id, externalId: row.externalId, orderId, receivedAt: row.receivedAt, review, mail: mail ? { sender: mail.sender, subject: mail.subject, receivedAt: mail.receivedAt, text: mail.text } : null, order: orderData };
  })));
}

export async function POST(request: NextRequest) {
  if (!teamAuthorised(request)) return failure("UNAUTHORISED", "需要登录后才能处理 Gmail 异常。", undefined, 401);
  const body = await request.json().catch(() => null);
  if (body?.decision === "RETRY" && typeof body.id === "string") {
    const row = await db.importedSourceMessage.findUnique({ where: { id: body.id } });
    if (!row || row.connector !== connector || row.action !== openAction) return failure("REVIEW_CHANGED", "异常记录已处理或不存在。", undefined, 409);
    try {
      const result = await ingestLifecycle(JSON.parse(row.sourceText).message, true);
      await db.importSyncRun.create({ data: { connector, status: "SUCCEEDED", completedAt: new Date(), cancelledCount: result === "cancelled" || result === "cancelledReview" ? 1 : 0, updatedCount: result === "amended" ? 1 : 0, skippedCount: result === "skipped" ? 1 : 0 } });
      return success({ result });
    } catch { return failure("RETRY_FAILED", "重新识别失败，请稍后重试。", undefined, 502); }
  }
  const ids = Array.isArray(body?.ids) ? body.ids : typeof body?.id === "string" ? [body.id] : [];
  const decision = body?.decision;
  if (!ids.length || ids.length > 100 || !ids.every((id: unknown) => typeof id === "string") || !["RESOLVED", "IGNORED", "ARCHIVED"].includes(decision) || (decision === "RESOLVED" && (typeof body?.note !== "string" || !body.note.trim() || body.note.length > 1000))) return failure("INVALID_REVIEW", "请提供有效的处理方式；“已处理”需要填写说明。", undefined, 422);
  const changed = await db.$transaction(async (tx) => {
    const rows = await tx.importedSourceMessage.findMany({ where: { id: { in: ids }, connector, action: openAction }, select: { id: true, orderId: true, externalId: true } });
    for (const row of rows) await tx.activityLog.create({ data: { orderId: row.orderId, action: "Gmail 异常待办已处理", actor: "运营人员", metadata: JSON.stringify({ messageId: row.externalId, decision, note: typeof body.note === "string" ? body.note.trim() : null }) } });
    if (rows.length) await tx.importedSourceMessage.updateMany({ where: { id: { in: rows.map((row) => row.id) }, action: openAction }, data: { action: `LIFECYCLE_EXCEPTION_${decision}` } });
    return rows.length;
  });
  return success({ changed });
}
