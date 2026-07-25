import { failure, success } from "@/lib/api-response";
import { getFleetReply } from "@/features/fleet-replies/service";

type Params = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Params) {
  try { return success(await getFleetReply((await params).id)); }
  catch { return failure("FLEET_REPLY_NOT_FOUND", "未找到这条车队回复。", undefined, 404); }
}
