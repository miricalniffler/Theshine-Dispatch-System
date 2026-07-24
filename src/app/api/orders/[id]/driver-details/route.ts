import { failure, success } from "@/lib/api-response";
import { getDriverDetails, saveDriverDetails } from "@/features/iway/service";
import { NextRequest } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  return success(await getDriverDetails(id));
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try { return success(await saveDriverDetails(id, await request.json())); }
  catch (error) { return failure("DRIVER_DETAILS_SAVE_FAILED", error instanceof Error && error.message === "ORDER_NOT_FOUND" ? "订单不存在。" : "司机资料保存失败。", undefined, 404); }
}
