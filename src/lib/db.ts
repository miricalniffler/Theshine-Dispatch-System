import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
// Neon can wake a compute between the initial read and an interactive write
// transaction. Keep the normal bounded transaction semantics, but leave
// enough time for a cold connection so that a driver save is not abandoned
// half-way through the existing audit/archive workflow.
export const db = globalForPrisma.prisma ?? new PrismaClient({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
// Vercel 会在同一个已暖机的运行实例中复用模块。生产环境也保留这个
// Prisma 实例，避免每一个页面/API 请求都重新建立到东京数据库的连接。
globalForPrisma.prisma = db;
export const persistenceMode = "postgresql" as const;
