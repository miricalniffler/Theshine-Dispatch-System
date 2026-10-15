import { findPersistedOrder } from "@/features/orders/sqlite-repository";
import { failure, success } from "@/lib/api-response";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const order = await findPersistedOrder((await params).id);
    if (!order) return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
    return success(order.activityLogs.map((item) => ({ action: item.action, at: item.createdAt, metadata: item.metadata })));
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    return failure(code === "P2021" || code === "P2022" ? "DATABASE_SCHEMA_OUTDATED" : "ORDER_ACTIVITY_READ_FAILED", "操作记录暂时无法读取，请稍后重试。", undefined, 503);
  }
}
