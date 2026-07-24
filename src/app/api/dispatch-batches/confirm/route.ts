import { confirmDispatch } from "@/features/dispatch/service";
import { failure, success } from "@/lib/api-response";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.batchId !== "string") return failure("INVALID_REQUEST", "缺少派单批次编号。", undefined, 422);
  try { return success(await confirmDispatch(body.batchId)); }
  catch { return failure("BATCH_NOT_FOUND", "找不到这次派单记录，请重新复制派单文本。", undefined, 404); }
}
