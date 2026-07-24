import { NextRequest, NextResponse } from "next/server";
import { createSqliteFleet, listSqliteFleets } from "@/features/fleets/sqlite-repository";
import { fleetInputSchema } from "@/features/fleets/validation";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return NextResponse.json({ data: await listSqliteFleets(request.nextUrl.searchParams.get("city") ?? undefined) });
}
export async function POST(request: NextRequest) {
  const result = fleetInputSchema.safeParse(await request.json());
  if (!result.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "请检查填写内容", fields: result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) } }, { status: 422 });
  return NextResponse.json({ data: await createSqliteFleet(result.data) }, { status: 201 });
}
