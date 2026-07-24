import { demoOrderRepository, queryToFilters } from "@/features/orders/demo-repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const filters = queryToFilters(request.nextUrl.searchParams);
  return NextResponse.json({ data: await demoOrderRepository.getSummary(filters) });
}
