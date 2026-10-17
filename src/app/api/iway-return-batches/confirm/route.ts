import { failure, success } from "@/lib/api-response";
import { confirmIwayReturn } from "@/features/iway/service";
import { NextRequest } from "next/server";
export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.batchId) return failure("INVALID_REQUEST", "缺少回传批次。", undefined, 422);
  try { return success(await confirmIwayReturn(body.batchId)); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("IWAY_PREVIEW_STALE:")) return failure("IWAY_PREVIEW_STALE", `订单资料已变化或已取消，旧回传预览不能确认：${message.slice("IWAY_PREVIEW_STALE:".length)}`, undefined, 409);
    if (message === "BATCH_NOT_FOUND") return failure("BATCH_NOT_FOUND", "未找到该回传批次，请重新生成。", undefined, 404);
    throw error;
  }
}
