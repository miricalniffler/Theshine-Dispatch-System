import { saveDispatchCopy } from "@/features/dispatch/service";
import { failure, success } from "@/lib/api-response";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.orderIds)) return failure("INVALID_REQUEST", "请选择需要派单的订单。", undefined, 422);
  return success(await saveDispatchCopy(body.orderIds));
}
