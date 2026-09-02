import { failure, success } from "@/lib/api-response";
import { prepareFirstContact, prepareFirstContacts } from "@/features/customer-notifications/service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.orderIds) || !body.orderIds.every((id: unknown) => typeof id === "string")) return failure("INVALID_REQUEST", "请选择需要联系的订单。", undefined, 422);
  try {
    const edits = body.oneOffTexts && typeof body.oneOffTexts === "object" ? body.oneOffTexts as Record<string, unknown> : {};
    if (!Object.keys(edits).length) return success(await prepareFirstContacts(body.orderIds));
    const results = await Promise.all(body.orderIds.map((orderId: string) => prepareFirstContact(orderId, { oneOffText: typeof edits[orderId] === "string" ? edits[orderId] : undefined })));
    return success({ prepared: results.filter((result) => result.eligible).length, newlyCreated: results.filter((result) => result.created).length, results });
  }
  catch { return failure("PREPARE_FAILED", "无法生成内部待发送记录。", undefined, 500); }
}
