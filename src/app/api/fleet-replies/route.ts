import { failure, success } from "@/lib/api-response";
import { createFleetReply } from "@/features/fleet-replies/service";

export async function POST(request: Request) {
  try { return success(await createFleetReply(await request.json())); }
  catch (error) {
    const message = error instanceof Error && error.message === "CONTEXT_REQUIRED" ? "请先选择本次车队回复所属的派单批次。" : error instanceof Error && error.message === "SOURCE_REQUIRED" ? "请粘贴车队原文或至少添加一张车辆图片。" : "无法保存车队回复。";
    return failure("FLEET_REPLY_CREATE_FAILED", message, undefined, 422);
  }
}
