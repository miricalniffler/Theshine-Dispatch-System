import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";

const businessFields = ["city", "fleetId", "serviceDate", "pickupDateTime", "pickupAddress", "dropoffAddress", "passengerName", "passengerPhone", "flightNumber", "platformVehicleType", "seatCount", "adults", "children", "luggage", "childSeatLine", "meetGreetLine", "otherNotes", "status"];
function teamAuthorised(request: NextRequest) { const expected = process.env.TEAM_ACCESS_TOKEN; return Boolean(expected) && request.cookies.get("iway-team-access")?.value === expected; }
function normalize(value: unknown) { return value instanceof Date ? value.toISOString() : value ?? null; }
function sameState(order: Record<string, unknown>, expected: Record<string, unknown>) { return businessFields.every((field) => String(normalize(order[field]) ?? "") === String(expected[field] ?? "")); }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  if (!teamAuthorised(request)) return failure("UNAUTHORISED", "需要登录后才能回滚 Gmail 修改。", undefined, 401);
  const { id, snapshotId } = await params;
  const result = await db.$transaction(async (tx) => {
    const snapshot = await tx.gmailOrderSnapshot.findFirst({ where: { id: snapshotId, orderId: id } });
    if (!snapshot || snapshot.rolledBackAt) return { kind: "missing" as const };
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) return { kind: "missing" as const };
    const after = snapshot.afterState as Record<string, unknown>;
    if (!sameState(order as unknown as Record<string, unknown>, after)) return { kind: "conflict" as const };
    const before = snapshot.beforeState as Record<string, unknown>;
    const restore = Object.fromEntries(businessFields.map((field) => [field, field === "pickupDateTime" && before[field] ? new Date(String(before[field])) : before[field] ?? null]));
    const rollback = await tx.gmailOrderSnapshot.create({ data: { orderId: id, kind: "ROLLBACK", beforeState: after as Prisma.InputJsonValue, afterState: before as Prisma.InputJsonValue, changedFields: JSON.parse(JSON.stringify(snapshot.changedFields)) as Prisma.InputJsonValue, sourceReceivedAt: new Date() } });
    await tx.order.update({ where: { id }, data: restore });
    await tx.gmailOrderSnapshot.update({ where: { id: snapshot.id }, data: { rolledBackAt: new Date(), rollbackSnapshotId: rollback.id } });
    await tx.activityLog.create({ data: { orderId: id, action: "已回滚 Gmail 自动变更", actor: "运营人员", metadata: JSON.stringify({ snapshotId, rollbackSnapshotId: rollback.id, fields: snapshot.changedFields }) } });
    return { kind: "restored" as const, rollbackId: rollback.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  if (result.kind === "missing") return failure("SNAPSHOT_NOT_AVAILABLE", "此 Gmail 修改记录不存在，或已经回滚。", undefined, 409);
  if (result.kind === "conflict") return failure("ROLLBACK_CONFLICT", "订单在此后已有人工或更新邮件改动，为避免覆盖，已拒绝回滚。", undefined, 409);
  return success(result);
}
