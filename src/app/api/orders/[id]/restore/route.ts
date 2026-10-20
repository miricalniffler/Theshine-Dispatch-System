import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";

const restorable = new Set(["PENDING_REVIEW", "READY_TO_DISPATCH", "DISPATCHED", "DRIVER_CONFIRMED", "RETURNED"]);
function previousStatus(metadata: string | null) { try { const value = JSON.parse(metadata ?? "{}"); return typeof value.previousStatus === "string" && restorable.has(value.previousStatus) ? value.previousStatus : null; } catch { return null; } }

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) return { kind: "missing" as const };
    if (order.status !== "CANCELLED") return { kind: "not-cancelled" as const };
    const cancellation = await tx.activityLog.findFirst({ where: { orderId: id, action: { in: ["订单已取消", "飞书邮件同步：订单已取消", "iWay 邮件：订单已取消"] } }, orderBy: { createdAt: "desc" } });
    if (!cancellation) return { kind: "history" as const };
    if (cancellation.action === "飞书邮件同步：订单已取消" || cancellation.action === "iWay 邮件：订单已取消") return { kind: "external" as const };
    const status = previousStatus(cancellation.metadata);
    if (!status) return { kind: "history" as const };
    const changed = await tx.order.updateMany({ where: { id, status: "CANCELLED" }, data: { status } });
    if (!changed.count) return { kind: "changed" as const };
    await tx.activityLog.create({ data: { orderId: id, action: "订单已恢复", actor: "运营人员", metadata: JSON.stringify({ restoredStatus: status, cancelledAt: cancellation.createdAt.toISOString() }) } });
    return { kind: "restored" as const, status };
  });
  if (result.kind === "missing") return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
  if (result.kind === "not-cancelled") return failure("ORDER_NOT_CANCELLED", "该订单当前不是已取消状态。", undefined, 409);
  if (result.kind === "external") return failure("EXTERNAL_STATUS_VERIFICATION_REQUIRED", "此订单由飞书同步取消。请先在外部平台核实恢复状态，不能只在本站恢复。", undefined, 409);
  if (result.kind === "history") return failure("RESTORE_HISTORY_UNAVAILABLE", "找不到可靠的取消前状态，为避免错误恢复，已阻止操作。", undefined, 409);
  if (result.kind === "changed") return failure("ORDER_CHANGED", "订单状态刚刚发生变化，请刷新后重试。", undefined, 409);
  return success({ status: result.status });
}
