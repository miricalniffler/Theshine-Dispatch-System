import { failure, success } from "@/lib/api-response";
import { createFleetReply } from "@/features/fleet-replies/service";
import { hasTeamAccess } from "@/lib/team-access";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  try { return success(await createFleetReply(await request.json())); }
  catch (error) {
    const message = error instanceof Error && error.message === "CONTEXT_REQUIRED" ? "请先选择本次车队回复所属的派单批次。" : error instanceof Error && error.message === "SOURCE_REQUIRED" ? "请粘贴车队原文或至少添加一张车辆图片。" : "无法保存车队回复。";
    return failure("FLEET_REPLY_CREATE_FAILED", message, undefined, 422);
  }
}
