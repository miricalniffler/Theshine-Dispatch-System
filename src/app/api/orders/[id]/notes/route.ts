import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note || note.length > 2000) return failure("INVALID_NOTE", "请输入异常备注（最多2000字）。", undefined, 422);
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { id: true } });
    if (!order) return null;
    return tx.activityLog.create({ data: { orderId: id, action: "新增异常备注", actor: "运营人员", metadata: JSON.stringify({ note }) } });
  });
  if (!result) return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
  return success({ id: result.id, at: result.createdAt });
}
