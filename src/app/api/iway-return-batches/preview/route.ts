import { failure, success } from "@/lib/api-response";
import { createIwayPreview } from "@/features/iway/service";
import { NextRequest } from "next/server";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.orderIds) || !body.orderIds.every((id: unknown) => typeof id === "string" && id)) return failure("INVALID_REQUEST", "请选择需要回传的订单。", undefined, 422);
  try { return success(await createIwayPreview(body.orderIds)); }
  catch { return failure("IWAY_PREVIEW_FAILED", "回传预览暂时无法生成；订单和司机资料没有被修改，请刷新后重试。", undefined, 503); }
}
