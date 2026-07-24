import { failure, success } from "@/lib/api-response";
import { translateThaiForReview } from "@/features/assist/service";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.text !== "string") return failure("INVALID_REQUEST", "请提供待翻译文本。", undefined, 422);
  return success(await translateThaiForReview(body.text));
}
