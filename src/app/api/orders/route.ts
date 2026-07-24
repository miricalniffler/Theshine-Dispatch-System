import { demoOrderRepository, queryToFilters } from "@/features/orders/demo-repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const filters = queryToFilters(request.nextUrl.searchParams);
  const orders = await demoOrderRepository.list(filters);
  return NextResponse.json({ data: orders, meta: { filters, source: "demo" } });
}
