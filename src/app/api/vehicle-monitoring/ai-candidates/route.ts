import { failure, success } from "@/lib/api-response";
import { findOrCreateAiCandidate, listAiVehicleCandidates, reviewAiVehicleCandidate } from "@/features/vehicle-monitoring/ai-candidates";

export async function GET() { return success({ candidates: await listAiVehicleCandidates() }); }

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.imageUrl !== "string" || !body.imageUrl.trim()) return failure("IMAGE_REQUIRED", "需要车辆图片才能请求 AI 候选。", undefined, 422);
  try { return success({ candidate: await findOrCreateAiCandidate(body) }); }
  catch (error) { return failure("AI_CANDIDATE_FAILED", error instanceof Error ? error.message : "AI 候选识别失败。", undefined, 422); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!body.candidateId || !["CONFIRM_ORDER", "REJECT", "SAVE_STANDARD"].includes(body.action)) return failure("INVALID_REVIEW", "请选择有效的候选处理操作。", undefined, 422);
  try { return success(await reviewAiVehicleCandidate(body.candidateId, body)); }
  catch (error) { return failure("AI_CANDIDATE_REVIEW_FAILED", error instanceof Error ? error.message : "候选处理失败。", undefined, 422); }
}
