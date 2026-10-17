import { success } from "@/lib/api-response";
import { listDriverWork } from "@/features/iway/service";
import { failure } from "@/lib/api-response";
import { NextRequest } from "next/server";
import { hasTeamAccess } from "@/lib/team-access";
export async function GET(request: NextRequest) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  return success(await listDriverWork());
}
