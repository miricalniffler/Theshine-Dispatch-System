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
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ORDER_NOT_FOUND") return failure("ORDER_NOT_FOUND", "订单不存在。", undefined, 404);
    if (code === "ORDER_CANCELLED") return failure("ORDER_CANCELLED", "订单已取消，不能再确认司机资料。", undefined, 409);
    return failure("DRIVER_DETAILS_SAVE_FAILED", "司机资料保存失败。", undefined, 500);
  }
}
