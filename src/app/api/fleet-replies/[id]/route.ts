import { failure, success } from "@/lib/api-response";
import { getFleetReply } from "@/features/fleet-replies/service";
import { hasTeamAccess } from "@/lib/team-access";
import { NextRequest } from "next/server";

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  try { return success(await getFleetReply((await params).id)); }
  catch { return failure("FLEET_REPLY_NOT_FOUND", "未找到这条车队回复。", undefined, 404); }
}
