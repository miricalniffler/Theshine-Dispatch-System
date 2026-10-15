import { findPersistedOrder, updatePersistedOrder } from "@/features/orders/sqlite-repository";
import { orderEditSchema } from "@/features/orders/order-edit-validation";
import { failure, success } from "@/lib/api-response";
import { formatInternationalPhone } from "@/lib/rules/engine";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const order = await findPersistedOrder((await params).id);
    if (!order) return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
    // Core order retrieval must never depend on an external paid AI request.
    // Translation remains available only from the explicit assistant action.
    return success({ ...order, passengerPhone: formatInternationalPhone(order.passengerPhone) ?? order.passengerPhone, assistance: { thaiTranslation: { status: "MANUAL_REVIEW_REQUIRED", provider: "按需识别", message: "如需翻译泰文，请在车队资料页面手动点击“分析并翻译”。" }, vehicleImage: { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "订单详情未保存车辆图片；如需识别，请在导入订单时提供图片地址。" } } });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "P2021" || code === "P2022") return failure("DATABASE_SCHEMA_OUTDATED", "测试数据库尚未完成必要升级，订单没有被删除。请联系管理员完成隔离测试库升级。", undefined, 503);
    return failure("ORDER_READ_FAILED", "订单暂时无法读取，请稍后重试。", undefined, 503);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = orderEditSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return failure("VALIDATION_ERROR", "请检查订单信息。", parsed.error.issues.map((issue) => issue.path.join(".")), 422);
  try {
    const result = await updatePersistedOrder((await params).id, parsed.data);
    if (result.kind === "not-found") return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
    if (result.kind === "cancelled") return failure("ORDER_CANCELLED", "已取消订单不能修改。", undefined, 409);
    return success({ order: result.order, updatedFields: result.updatedFields });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") return failure("DUPLICATE_ORDER_NUMBER", "该平台订单号已存在。", ["platformOrderNumber"], 409);
    throw error;
  }
}
