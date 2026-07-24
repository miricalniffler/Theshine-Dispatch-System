import { failure, success } from "@/lib/api-response";
import { createIwayPreview } from "@/features/iway/service";
import { NextRequest } from "next/server";
export async function POST(request: NextRequest) { const body = await request.json(); if (!Array.isArray(body.orderIds)) return failure("INVALID_REQUEST", "请选择需要回传的订单。", undefined, 422); return success(await createIwayPreview(body.orderIds)); }
