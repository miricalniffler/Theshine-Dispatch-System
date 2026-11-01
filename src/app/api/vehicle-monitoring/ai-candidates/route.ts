import { failure, success } from "@/lib/api-response";
import { findOrCreateAiCandidate } from "@/features/vehicle-monitoring/ai-candidates";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.imageUrl !== "string" || !body.imageUrl.trim()) return failure("IMAGE_REQUIRED", "需要车辆图片才能请求 AI 候选。", undefined, 422);
  try { return success({ candidate: await findOrCreateAiCandidate(body) }); }
  catch (error) { return failure("AI_CANDIDATE_FAILED", error instanceof Error ? error.message : "AI 候选识别失败。", undefined, 422); }
}
