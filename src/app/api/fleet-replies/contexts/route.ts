import { failure, success } from "@/lib/api-response";
import { listReplyContexts } from "@/features/fleet-replies/service";
import { hasTeamAccess } from "@/lib/team-access";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  return success(await listReplyContexts());
}
