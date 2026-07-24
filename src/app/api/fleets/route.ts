import { NextRequest, NextResponse } from "next/server";
import { listSqliteFleets } from "@/features/fleets/sqlite-repository";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return NextResponse.json({ data: await listSqliteFleets(request.nextUrl.searchParams.get("city") ?? undefined) });
}
export async function POST(request: NextRequest) {
  await request.json().catch(() => ({}));
  return NextResponse.json({ error: { code: "FIXED_FLEET_DIRECTORY", message: "第一期固定使用曼谷车队和苏梅车队，不能新增其他车队。", fields: [] } }, { status: 409 });
}
