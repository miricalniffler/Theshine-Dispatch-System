import { failure, success } from "@/lib/api-response";
import { confirmIwayReturn } from "@/features/iway/service";
import { NextRequest } from "next/server";
export async function POST(request: NextRequest) { const body = await request.json(); if (!body.batchId) return failure("INVALID_REQUEST", "缺少回传批次。", undefined, 422); try { return success(await confirmIwayReturn(body.batchId)); } catch { return failure("BATCH_NOT_FOUND", "未找到该回传批次，请重新生成。", undefined, 404); } }
