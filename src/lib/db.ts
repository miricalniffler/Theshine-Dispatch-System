import { PrismaClient } from "@prisma/client";
import { isIsolatedPreview } from "@/lib/isolated-preview";

// The cloud acceptance Preview receives a separately prefixed Neon
// connection. Keep this opt-in: ordinary Preview and Production deployments
// continue using their own DATABASE_URL, while the isolated PR environment
// cannot accidentally reach an existing business database.
if (isIsolatedPreview) {
  process.env.DATABASE_URL = process.env.PR12_TEST_DATABASE_URL;
  if (process.env.PR12_TEST_DATABASE_URL_UNPOOLED) process.env.DIRECT_URL = process.env.PR12_TEST_DATABASE_URL_UNPOOLED;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient();
// Vercel 会在同一个已暖机的运行实例中复用模块。生产环境也保留这个
// Prisma 实例，避免每一个页面/API 请求都重新建立到东京数据库的连接。
globalForPrisma.prisma = db;
export const persistenceMode = "postgresql" as const;
