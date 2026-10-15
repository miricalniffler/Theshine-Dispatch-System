import { failure, success } from "@/lib/api-response";
import { saveIwayCopy } from "@/features/iway/service";
import { NextRequest } from "next/server";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.orderIds) || !body.orderIds.every((id: unknown) => typeof id === "string" && id)) return failure("INVALID_REQUEST", "请选择需要回传的订单。", undefined, 422);
  try { return success(await saveIwayCopy(body.orderIds)); }
  catch { return failure("IWAY_COPY_FAILED", "回传内容暂时无法保存或复制；订单状态没有被修改，请刷新后重试。", undefined, 503); }
}
