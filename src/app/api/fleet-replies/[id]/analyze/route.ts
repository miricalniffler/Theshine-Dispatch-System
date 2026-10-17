import { failure, success } from "@/lib/api-response";
import { analyzeFleetReply } from "@/features/fleet-replies/service";
import { hasTeamAccess } from "@/lib/team-access";
import { NextRequest } from "next/server";
import { z } from "zod";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };
const imageSchema = z.object({ dataUrl: z.string().regex(/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i).max(8_000_000), filename: z.string().max(200).optional(), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(), kind: z.enum(["screenshot", "vehicle"]).optional() });
const bodySchema = z.object({ images: z.array(imageSchema).max(4).default([]) });
export async function POST(request: NextRequest, { params }: Params) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  try { return success(await analyzeFleetReply((await params).id, bodySchema.parse(await request.json()).images)); }
  catch (error) { return failure("FLEET_REPLY_ANALYSIS_FAILED", error instanceof Error && error.message === "CONTEXT_REQUIRED" ? "该回复没有可匹配的订单范围。" : "车队回复识别无法开始。", undefined, 422); }
}
