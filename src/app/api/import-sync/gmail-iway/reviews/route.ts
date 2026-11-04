import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";
import { ingestLifecycle, previewLifecycleReview, type MailReview } from "@/features/import/gmail-lifecycle";
import { classifyLifecycleNotice } from "@/features/import/iway-lifecycle-parser";

export async function GET() {
  const rows = await db.importedSourceMessage.findMany({ where: { connector: "gmail-iway", action: "LIFECYCLE_REVIEW_PENDING" }, orderBy: { processedAt: "desc" }, take: 100 });
  return success(await Promise.all(rows.map(async row => {
    let review: MailReview | null = null;
    let orderId = row.orderId;
    try {
      const source = JSON.parse(row.sourceText);
      review = source.review;
      if (review && source.message && review.reason !== "CANCELLED_NOTIFY_FLEET") {
        const message = source.message;
        const notice = classifyLifecycleNotice(message.subject, message.text, message.fields);
        const order = notice?.orderNumber ? await db.order.findUnique({ where: { platformOrderNumber: notice.orderNumber } }) : null;
        review = previewLifecycleReview(message, review, order);
        orderId = order?.id ?? null;
      }
    } catch { /* malformed protected audit */ }
    return { id: row.id, orderId, receivedAt: row.receivedAt, review };
  })));
}
export async function POST(request: Request) {
  const body = await request.json().catch(()=>null);
  if (body?.decision === "RETRY" && typeof body.id === "string") {
    const row = await db.importedSourceMessage.findUnique({ where: { id: body.id } });
    if (!row || row.connector !== "gmail-iway" || row.action !== "LIFECYCLE_REVIEW_PENDING") return failure("REVIEW_CHANGED", "待办不存在或已处理。", undefined, 409);
    try {
      const result = await ingestLifecycle(JSON.parse(row.sourceText).message, true);
      await db.importSyncRun.create({ data: { connector: "gmail-iway", status: "SUCCEEDED", completedAt: new Date(), cancelledCount: result === "cancelled" || result === "cancelledReview" ? 1 : 0, updatedCount: result === "review" || result === "cancelledReview" ? 1 : 0, skippedCount: result === "skipped" ? 1 : 0 } });
      return success({ result });
    }
    catch { return failure("RETRY_FAILED", "重新识别失败，请稍后重试。", undefined, 502); }
  }
  if (!body || typeof body.id !== "string" || !["REVIEWED", "DISMISSED", "FLEET_NOTIFIED"].includes(body.decision) || typeof body.note !== "string" || !body.note.trim() || body.note.length > 1000) return failure("INVALID_REVIEW", "请填写人工处理结果（最多1000字）。", undefined, 422);
  const result = await db.$transaction(async tx => {
    const row = await tx.importedSourceMessage.findUnique({ where: { id: body.id } });
    if (!row || row.connector !== "gmail-iway" || row.action !== "LIFECYCLE_REVIEW_PENDING") return false;
    const changed = await tx.importedSourceMessage.updateMany({ where: { id: row.id, action: "LIFECYCLE_REVIEW_PENDING" }, data: { action: `LIFECYCLE_${body.decision}` } });
    if (!changed.count) return false;
    await tx.activityLog.create({ data: { orderId: row.orderId, action: "Gmail 邮件人工处理完成", actor: "运营人员", metadata: JSON.stringify({ messageId: row.externalId, decision: body.decision, note: body.note.trim() }) } });
    return true;
  });
  return result ? success({ reviewed: true }) : failure("REVIEW_CHANGED", "记录已处理或不存在，请刷新。", undefined, 409);
}
