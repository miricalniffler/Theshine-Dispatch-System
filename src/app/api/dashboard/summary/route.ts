import { queryToFilters } from "@/features/orders/demo-repository";
import { listSqliteOrders } from "@/features/orders/sqlite-repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const filters = queryToFilters(request.nextUrl.searchParams);
  const orders = await listSqliteOrders(filters);
  return NextResponse.json({ data: { total: orders.length, pendingReview: orders.filter((order) => order.status === "PENDING_REVIEW").length, readyToDispatch: orders.filter((order) => order.status === "READY_TO_DISPATCH").length, dispatched: orders.filter((order) => order.status === "DISPATCHED").length, pendingDriver: orders.filter((order) => order.status === "DISPATCHED").length, pendingReturn: orders.filter((order) => order.status === "DRIVER_CONFIRMED" || order.status === "RETURNED").length, exceptions: orders.filter((order) => order.exceptions.length > 0).length }, meta: { filters, source: "sqlite" } });
}
