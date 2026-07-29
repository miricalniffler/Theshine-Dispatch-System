import { failure, success } from "@/lib/api-response";
import { analyzeFleetReply } from "@/features/fleet-replies/service";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };
export async function POST(_request: Request, { params }: Params) {
  try { return success(await analyzeFleetReply((await params).id)); }
  catch (error) { return failure("FLEET_REPLY_ANALYSIS_FAILED", error instanceof Error && error.message === "CONTEXT_REQUIRED" ? "该回复没有可匹配的订单范围。" : "车队回复识别无法开始。", undefined, 422); }
}
