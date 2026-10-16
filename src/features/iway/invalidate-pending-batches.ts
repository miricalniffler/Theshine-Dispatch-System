import { Prisma } from "@prisma/client";

type Transaction = Prisma.TransactionClient;

/**
 * A copied preview is a point-in-time document. A lifecycle transition must
 * never let an older copy later mark an order returned.
 */
export async function invalidatePendingIwayBatches(tx: Transaction, orderId: string, reason: string) {
  return tx.iwayReturnBatch.updateMany({
    where: {
      confirmedAt: null,
      invalidatedAt: null,
      orders: { some: { orderId } },
    },
    data: { invalidatedAt: new Date(), invalidatedReason: reason },
  });
}
