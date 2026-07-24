import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const expected = [
  { city: "曼谷", name: "曼谷车队" },
  { city: "苏梅", name: "苏梅车队" },
];

try {
  const result = await db.$transaction(async (tx) => {
    const summary = [];
    for (const target of expected) {
      let canonical = await tx.fleet.findUnique({ where: { name_city: target } });
      if (!canonical) {
        const existing = await tx.fleet.findFirst({ where: { city: target.city }, orderBy: { createdAt: "asc" } });
        canonical = existing
          ? await tx.fleet.update({ where: { id: existing.id }, data: { name: target.name, city: target.city, isActive: true } })
          : await tx.fleet.create({ data: { ...target, isActive: true } });
      }
      const orders = await tx.order.findMany({ where: { city: target.city, OR: [{ fleetId: null }, { NOT: { fleetId: canonical.id } }] }, select: { id: true } });
      if (orders.length) {
        await tx.order.updateMany({ where: { id: { in: orders.map((order) => order.id) } }, data: { fleetId: canonical.id } });
        await tx.activityLog.createMany({ data: orders.map((order) => ({ orderId: order.id, action: "系统迁移：已按服务城市自动分配车队", actor: "系统", metadata: JSON.stringify({ city: target.city, fleetName: canonical.name }) })) });
      }
      const duplicates = await tx.fleet.findMany({ where: { city: target.city, NOT: { id: canonical.id } }, select: { id: true } });
      if (duplicates.length) {
        await tx.order.updateMany({ where: { fleetId: { in: duplicates.map((fleet) => fleet.id) } }, data: { fleetId: canonical.id } });
        await tx.fleet.deleteMany({ where: { id: { in: duplicates.map((fleet) => fleet.id) } } });
      }
      summary.push({ city: target.city, fleet: canonical.name, assignedOrders: orders.length, removedDuplicates: duplicates.length });
    }
    return summary;
  });
  console.log(JSON.stringify(result));
} finally {
  await db.$disconnect();
}
