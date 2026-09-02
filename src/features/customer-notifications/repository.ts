import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type PendingCustomerNotificationInput = {
  orderId: string;
  notificationType: "FIRST_CONTACT" | "AIRPORT_GUIDE" | "DRIVER_INFO" | "DRIVER_INFO_UPDATE";
  recipientPhone: string;
  idempotencyKey: string;
  contentSnapshot?: Prisma.InputJsonValue;
  templateSnapshot?: Prisma.InputJsonValue;
  driverVehicleSnapshot?: Prisma.InputJsonValue;
  airportGuideSnapshot?: Prisma.InputJsonValue;
};

/**
 * Foundation-only outbox writer. It deliberately never calls Meta/WhatsApp and
 * never changes an order status. WP2 will add preview/send workers on top of it.
 */
export async function createPendingCustomerNotification(input: PendingCustomerNotificationInput) {
  const existing = await db.customerNotification.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { notification: existing, created: false };
  const notification = await db.customerNotification.create({ data: { ...input, status: "PENDING" } });
  return { notification, created: true };
}

export async function listCustomerNotificationsForOrder(orderId: string) {
  return db.customerNotification.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });
}
