import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 500) return failure("INVALID_REASON", "请填写取消原因（最多500字）。", undefined, 422);
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) return { kind: "missing" as const };
    if (existing.status === "CANCELLED") return { kind: "already" as const };
    if (existing.status === "COMPLETED") return { kind: "completed" as const };
    const changed = await tx.order.updateMany({ where: { id, status: existing.status }, data: { status: "CANCELLED" } });
    if (!changed.count) return { kind: "conflict" as const };
    await tx.activityLog.create({ data: { orderId: id, action: "订单已取消", actor: "运营人员", metadata: JSON.stringify({ reason, previousStatus: existing.status }) } });
    return { kind: "cancelled" as const };
  });
  if (result.kind === "missing") return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
  if (result.kind === "already") return failure("ALREADY_CANCELLED", "该订单已经取消。", undefined, 409);
  if (result.kind === "completed") return failure("COMPLETED_ORDER", "已完成订单不能直接取消，请记录异常。", undefined, 409);
  if (result.kind === "conflict") return failure("ORDER_CHANGED", "订单状态刚刚发生变化，请刷新后重试。", undefined, 409);
  return success({ status: "CANCELLED" });
}
