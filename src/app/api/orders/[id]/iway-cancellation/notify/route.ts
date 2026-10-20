import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const orderId = (await params).id;
  const result = await db.$transaction(async (tx) => {
    const item = await tx.iwayCancellationCase.findFirst({ where: { orderId, fleetNotificationStatus: "PENDING" }, orderBy: { processedAt: "desc" } });
    if (!item) return null;
    const updated = await tx.iwayCancellationCase.updateMany({ where: { id: item.id, fleetNotificationStatus: "PENDING" }, data: { fleetNotificationStatus: "NOTIFIED", fleetNotifiedAt: new Date(), fleetNotifiedBy: "运营人员" } });
    if (!updated.count) return false;
    await tx.activityLog.create({ data: { orderId, action: "已通知车队：iWay 订单取消", actor: "运营人员", metadata: JSON.stringify({ cancellationCaseId: item.id }) } });
    return true;
  });
  if (result === null) return failure("NO_PENDING_FLEET_NOTIFICATION", "当前订单没有待通知车队事项。", undefined, 409);
  if (!result) return failure("NOTIFICATION_CHANGED", "通知状态刚刚发生变化，请刷新后重试。", undefined, 409);
  return success({ fleetNotificationStatus: "NOTIFIED" });
}
