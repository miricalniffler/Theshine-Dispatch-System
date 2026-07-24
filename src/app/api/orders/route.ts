import { demoOrderRepository, queryToFilters } from "@/features/orders/demo-repository";
import { listSqliteOrders, saveOrderToSqlite } from "@/features/orders/sqlite-repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const filters = queryToFilters(request.nextUrl.searchParams);
  let orders = await listSqliteOrders(filters);
  if (!orders.length) {
    const allPersisted = await listSqliteOrders({});
    if (!allPersisted.length) {
      const demo = await demoOrderRepository.list({ dateMode: "future" });
      await Promise.all(demo.map(saveOrderToSqlite));
      orders = await listSqliteOrders(filters);
    }
  }
  // Development demo rows created by older builds did not keep their fleet
  // relation. Repair only those missing relations; never overwrite status or
  // any manually edited order fields.
  const demoOrders = await demoOrderRepository.list({ dateMode: "future" });
  await Promise.all(demoOrders.map(async (demo) => {
    const persisted = (await listSqliteOrders({ keyword: demo.orderNo }))[0];
    if (persisted?.fleetName === "待选择") await saveOrderToSqlite({ ...demo, status: persisted.status });
  }));
  orders = await listSqliteOrders(filters);
  return NextResponse.json({ data: orders, meta: { filters, source: "sqlite" } });
}
