import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@/lib/api-response";

function teamAuthorised(request: NextRequest) { const expected = process.env.TEAM_ACCESS_TOKEN; return Boolean(expected) && request.cookies.get("iway-team-access")?.value === expected; }
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!teamAuthorised(request)) return new Response(JSON.stringify({ error: { message: "需要登录后才能读取 Gmail 修改历史。" } }), { status: 401 });
  const snapshots = await db.gmailOrderSnapshot.findMany({ where: { orderId: (await params).id }, orderBy: { appliedAt: "desc" }, select: { id: true, kind: true, changedFields: true, beforeState: true, afterState: true, sourceReceivedAt: true, appliedAt: true, rolledBackAt: true } });
  return success(snapshots);
}
