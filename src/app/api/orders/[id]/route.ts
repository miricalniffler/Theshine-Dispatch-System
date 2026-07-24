import { findPersistedOrder, updatePersistedOrder } from "@/features/orders/sqlite-repository";
import { orderEditSchema } from "@/features/orders/order-edit-validation";
import { translateThaiForReview } from "@/features/assist/service";
import { failure, success } from "@/lib/api-response";
import { formatInternationalPhone } from "@/lib/rules/engine";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const order = await findPersistedOrder((await params).id);
  if (!order) return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
  const thaiTranslation = await translateThaiForReview(order.rawSource || "");
  return success({ ...order, passengerPhone: formatInternationalPhone(order.passengerPhone) ?? order.passengerPhone, assistance: { thaiTranslation, vehicleImage: { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "订单详情未保存车辆图片；如需识别，请在导入订单时提供图片地址。" } } });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = orderEditSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return failure("VALIDATION_ERROR", "请检查订单信息。", parsed.error.issues.map((issue) => issue.path.join(".")), 422);
  try {
    const result = await updatePersistedOrder((await params).id, parsed.data);
    if (result.kind === "not-found") return failure("ORDER_NOT_FOUND", "找不到该订单。", undefined, 404);
    return success({ order: result.order, updatedFields: result.updatedFields });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") return failure("DUPLICATE_ORDER_NUMBER", "该平台订单号已存在。", ["platformOrderNumber"], 409);
    throw error;
  }
}
