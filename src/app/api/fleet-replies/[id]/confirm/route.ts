import { failure, success } from "@/lib/api-response";
import { confirmFleetReply } from "@/features/fleet-replies/service";

type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  try { return success(await confirmFleetReply((await params).id, await request.json())); }
  catch { return failure("FLEET_REPLY_CONFIRM_FAILED", "无法确认写入；请保留原文并检查所填资料。", undefined, 422); }
}
