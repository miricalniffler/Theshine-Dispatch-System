import { invalidatePendingIwayBatches } from "@/features/iway/invalidate-pending-batches";
import { failure, success } from "@/lib/api-response";
import { db } from "@/lib/db";

const restorableStatuses = new Set(["PENDING_REVIEW", "READY_TO_DISPATCH", "DISPATCHED", "DRIVER_CONFIRMED", "RETURNED"]);

function previousStatus(metadata: string | null) {
  try {
    const value = JSON.parse(metadata ?? "{}") as { previousStatus?: unknown };
    return typeof value.previousStatus === "string" && restorableStatuses.has(value.previousStatus) ? value.previousStatus : null;
  } catch { return null; }
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!order) return { kind: "missing" as const };
    if (order.status !== "CANCELLED") return { kind: "not-cancelled" as const };

    const cancellation = await tx.activityLog.findFirst({
      where: { orderId: id, action: { in: ["订单已取消", "飞书邮件同步：订单已取消"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!cancellation) return { kind: "missing-history" as const };
    if (cancellation.action === "飞书邮件同步：订单已取消") return { kind: "external-verification-required" as const };
    const status = previousStatus(cancellation.metadata);
    if (!status) return { kind: "invalid-history" as const };

    // The condition is the concurrency guard: a new cancellation or external
    // synchronization event wins instead of being overwritten by this restore.
    const restored = await tx.order.updateMany({ where: { id, status: "CANCELLED" }, data: { status } });
    if (!restored.count) return { kind: "conflict" as const };
    await invalidatePendingIwayBatches(tx, id, "订单已恢复，旧回传预览失效");
    await tx.activityLog.create({
      data: { orderId: id, action: "订单已恢复", actor: "运营人员", metadata: JSON.stringify({ restoredStatus: status, cancelledAt: cancellation.createdAt.toISOString(), cancellationReason: cancellation.metadata }) },
    });
    return { kind: "restored" as const, status };
  });
  if (result.kind === "missing") return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
  if (result.kind === "not-cancelled") return failure("ORDER_NOT_CANCELLED", "该订单当前不是已取消状态，请刷新后重试。", undefined, 409);
  if (result.kind === "external-verification-required") return failure("EXTERNAL_STATUS_VERIFICATION_REQUIRED", "此订单由飞书同步取消。请先在外部平台核实订单已恢复，再通过新的同步记录更新，不能只在本站恢复。", undefined, 409);
  if (result.kind === "missing-history" || result.kind === "invalid-history") return failure("RESTORE_HISTORY_UNAVAILABLE", "找不到可靠的取消前状态，为避免错误恢复，已阻止操作。", undefined, 409);
  if (result.kind === "conflict") return failure("ORDER_CHANGED", "订单状态刚刚发生变化，请刷新后重试。", undefined, 409);
  return success({ status: result.status });
}
