import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * 第一阶段的业务约定：每个服务城市只有一个固定车队。
 * 订单永远按城市自动路由，不能由前端传入的 fleetId 改写。
 */
export const canonicalFleets = {
  "曼谷": { name: "曼谷车队", city: "曼谷" },
  "苏梅": { name: "苏梅车队", city: "苏梅" },
} as const;

export type SupportedFleetCity = keyof typeof canonicalFleets;
type FleetDb = PrismaClient | Prisma.TransactionClient;

export function isSupportedFleetCity(value: string): value is SupportedFleetCity {
  return value === "曼谷" || value === "苏梅";
}

export async function canonicalFleetForCity(database: FleetDb, city: string) {
  if (!isSupportedFleetCity(city)) throw new Error(`UNSUPPORTED_FLEET_CITY:${city}`);
  const fleet = canonicalFleets[city];
  return database.fleet.upsert({
    where: { name_city: { name: fleet.name, city: fleet.city } },
    update: {},
    create: { name: fleet.name, city: fleet.city, isActive: true },
  });
}
