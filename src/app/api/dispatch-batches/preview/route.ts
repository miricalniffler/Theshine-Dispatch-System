import { createDispatchPreview } from "@/features/dispatch/service";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.orderIds)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "orderIds 必须是订单编号数组。" } }, { status: 400 });
  const preview = await createDispatchPreview(body.orderIds);
  return NextResponse.json({ data: preview }, { status: preview.valid ? 200 : 422 });
}
