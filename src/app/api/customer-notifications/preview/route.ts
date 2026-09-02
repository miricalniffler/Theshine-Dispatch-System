import { failure, success } from "@/lib/api-response";
import { previewFirstContacts } from "@/features/customer-notifications/service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.orderIds) || !body.orderIds.every((id: unknown) => typeof id === "string")) return failure("INVALID_REQUEST", "请选择需要联系的订单。", undefined, 422);
  try { return success({ items: await previewFirstContacts(body.orderIds) }); }
  catch { return failure("PREVIEW_FAILED", "无法生成客人联系预览。", undefined, 500); }
}
