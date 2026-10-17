import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({}));
  const value = typeof body.note === "string" ? body.note.trim() : "";
  if (!value || value.length > 2000) return failure("INVALID_NOTE", "请输入异常备注（最多2000字）。", undefined, 422);
  const id = (await params).id;
  const result = await db.$transaction(async (tx) => {
    if (!await tx.order.findUnique({ where: { id }, select: { id: true } })) return null;
    return tx.activityLog.create({ data: { orderId: id, action: "新增异常备注", actor: "运营人员", metadata: JSON.stringify({ note: value }) } });
  });
  if (!result) return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
  return success({ id: result.id, at: result.createdAt });
}
