import { NextRequest, NextResponse } from "next/server";
import { listSqliteFleets } from "@/features/fleets/sqlite-repository";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return NextResponse.json({ data: await listSqliteFleets(request.nextUrl.searchParams.get("city") ?? undefined) });
}
export async function POST(request: NextRequest) {
  await request.json().catch(() => ({}));
  return NextResponse.json({ error: { code: "FIXED_FLEET_DIRECTORY", message: "车队目录由系统按正式运营城市自动维护，不能手动新增其他车队。", fields: [] } }, { status: 409 });
}
