import { queryToFilters } from "@/features/orders/demo-repository";
import { listSqliteOrders } from "@/features/orders/sqlite-repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const filters = queryToFilters(request.nextUrl.searchParams);
  const orders = await listSqliteOrders(filters);
  return NextResponse.json({ data: orders, meta: { filters, source: "postgresql" } });
}
