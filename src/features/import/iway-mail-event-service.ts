import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ImportedMessage } from "./connectors";
import { classifyIwayMail } from "./iway-mail-events";

export type IwayMailApplyResult = "created" | "cancelled" | "updated" | "skipped";

function eventDate(value?: string) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; }
function reason(message: ImportedMessage) { return message.subject?.trim().slice(0, 500) || "iWay 明确取消邮件"; }

/** Processes only a trusted, classified event. It never sends outbound messages. */
export async function applyIwayMailEvent(message: ImportedMessage): Promise<IwayMailApplyResult | null> {
  const event = classifyIwayMail(message);
  if (event.type === "NEW_ORDER") return null; // existing importer owns validated new-order creation
  const existingMessage = await db.iwayMailEvent.findUnique({ where: { externalId: message.id } });
  if (existingMessage) return "skipped";
  const order = event.orderNo ? await db.order.findUnique({ where: { platformOrderNumber: event.orderNo }, include: { driverDetail: true, driverVehicleAssignments: { where: { isCurrent: true }, include: { driverProfile: true, vehicleProfile: true } } } }) : null;
  try {
    return await db.$transaction(async (tx) => {
      const saved = await tx.iwayMailEvent.create({ data: { externalId: message.id, sender: message.sender?.slice(0, 320) || null, subject: message.subject?.slice(0, 500) || null, eventType: event.type, disposition: "REVIEW", orderId: order?.id || null, eventAt: eventDate(message.receivedAt), reason: event.reason } });
      if (event.type === "REVIEW" || !order) return "skipped";
      if (event.type === "MODIFICATION") {
        await tx.iwayChangeDraft.create({ data: { orderId: order.id, mailEventId: saved.id, changes: JSON.stringify({ source: "iWay 邮件", subject: message.subject || null }), status: "PENDING_REVIEW" } });
        await tx.iwayMailEvent.update({ where: { id: saved.id }, data: { disposition: "PENDING_REVIEW" } });
        await tx.activityLog.create({ data: { orderId: order.id, action: "iWay 修改待确认", actor: "系统邮件同步", metadata: JSON.stringify({ messageId: message.id, eventAt: message.receivedAt || null }) } });
        return "updated";
      }
      if (order.status === "COMPLETED" || order.status === "CANCELLED") { await tx.iwayMailEvent.update({ where: { id: saved.id }, data: { disposition: "PENDING_REVIEW", reason: order.status === "COMPLETED" ? "已完成订单收到取消邮件，需人工核对" : "订单已取消，未重复处理" } }); return "skipped"; }
      const restored = await tx.iwayCancellationCase.findFirst({ where: { orderId: order.id, restoredAt: { not: null } }, orderBy: { restoredAt: "desc" } });
      if (restored?.restoredAt && eventDate(message.receivedAt) && eventDate(message.receivedAt)! <= restored.restoredAt) { await tx.iwayMailEvent.update({ where: { id: saved.id }, data: { disposition: "IGNORED", reason: "人工恢复后的旧取消邮件，不重复取消" } }); return "skipped"; }
      const changed = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: "CANCELLED" } });
      if (!changed.count) return "skipped";
      const hasAssignment = Boolean(order.driverDetail?.confirmedDriverName || order.driverVehicleAssignments.length);
      await tx.iwayCancellationCase.create({ data: { orderId: order.id, mailEventId: saved.id, previousStatus: order.status, cancellationReason: reason(message), mailReceivedAt: eventDate(message.receivedAt), fleetNotificationStatus: hasAssignment ? "PENDING" : "NOT_REQUIRED", assignmentSnapshot: hasAssignment ? JSON.stringify({ driver: order.driverDetail?.confirmedDriverName || null, vehicle: order.driverDetail?.confirmedVehicleModel || null, plate: order.driverDetail?.licensePlate || null }) : null } });
      await tx.iwayMailEvent.update({ where: { id: saved.id }, data: { disposition: "APPLIED" } });
      await tx.activityLog.create({ data: { orderId: order.id, action: "iWay 邮件：订单已取消", actor: "系统邮件同步", metadata: JSON.stringify({ messageId: message.id, eventAt: message.receivedAt || null, previousStatus: order.status, fleetNotification: hasAssignment ? "PENDING" : "NOT_REQUIRED" }) } });
      return "cancelled";
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "skipped";
    throw error;
  }
}
