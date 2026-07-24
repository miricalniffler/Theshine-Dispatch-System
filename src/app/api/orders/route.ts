import { demoOrderRepository, queryToFilters } from "@/features/orders/demo-repository";
import { listSqliteOrders, saveOrderToSqlite } from "@/features/orders/sqlite-repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const filters = queryToFilters(request.nextUrl.searchParams);
  let orders = await listSqliteOrders();
  if (!orders.length) { const demo = await demoOrderRepository.list({ dateMode: "future" }); await Promise.all(demo.map(saveOrderToSqlite)); orders = await listSqliteOrders(); }
  return NextResponse.json({ data: orders, meta: { filters, source: "sqlite" } });
}
