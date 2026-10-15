import { queryToFilters } from "@/features/orders/demo-repository";
import { listSqliteOrders } from "@/features/orders/sqlite-repository";
import { failure } from "@/lib/api-response";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const filters = queryToFilters(request.nextUrl.searchParams);
  try {
    const orders = await listSqliteOrders(filters);
    return NextResponse.json({ data: orders, meta: { filters, source: "postgresql" } });
  } catch (error) {
    // Do not leak connection details or query text, but preserve an actionable
    // server log for the deployment owner instead of turning a failure into [].
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "UNKNOWN";
    console.error("orders_list_failed", { code });
    const message = code === "P2021" || code === "P2022"
      ? "测试数据库的表结构尚未完成当前版本升级，订单暂时无法读取。"
      : "订单暂时无法读取；请稍后重试或检查测试数据库连接。";
    return failure("ORDERS_QUERY_FAILED", message, undefined, 503);
  }
}
