import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";
import type { MailReview } from "@/features/import/gmail-lifecycle";

export async function GET() {
  const rows = await db.importedSourceMessage.findMany({ where: { connector: "gmail-iway", action: "LIFECYCLE_REVIEW_PENDING" }, orderBy: { processedAt: "desc" }, take: 100 });
  return success(rows.map(row => {
    let review: MailReview | null = null;
    try { review = JSON.parse(row.sourceText).review; } catch { /* malformed protected audit */ }
    return { id: row.id, orderId: row.orderId, receivedAt: row.receivedAt, review };
  }));
}
export async function POST(request: Request) {
  const body = await request.json().catch(()=>null);
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
