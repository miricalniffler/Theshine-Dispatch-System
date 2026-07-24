/**
 * 数据库适配器入口。
 *
 * `prisma/schema.prisma` 已定义正式 SQLite 数据模型；待网络恢复并安装 Prisma
 * 客户端后，在此处接入即可。当前一期界面先通过各功能模块的本地仓库运行，
 * 避免未安装的数据库客户端阻断页面验证。
 */
export const persistenceMode = "local-demo" as const;
