import { failure, success } from "@/lib/api-response";
import { confirmFleetReply } from "@/features/fleet-replies/service";
import { hasTeamAccess } from "@/lib/team-access";
import { NextRequest } from "next/server";

type Params = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Params) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  try { return success(await confirmFleetReply((await params).id, await request.json())); }
  catch { return failure("FLEET_REPLY_CONFIRM_FAILED", "无法确认写入；请保留原文并检查所填资料。", undefined, 422); }
}
