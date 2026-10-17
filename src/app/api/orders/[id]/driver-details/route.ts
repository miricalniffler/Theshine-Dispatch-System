import { failure, success } from "@/lib/api-response";
import { getDriverDetails, saveDriverDetails } from "@/features/iway/service";
import { NextRequest } from "next/server";
import { hasTeamAccess } from "@/lib/team-access";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const optionalText = z.string().max(4_000).optional().nullable();
const driverDetailsInput = z.object({
  rawReply: z.string().max(20_000).optional().default(""),
  confirmedDriverName: optionalText,
  rawDriverPhone: optionalText,
  confirmedVehicleModel: optionalText,
  licensePlate: optionalText,
  rawThaiDriverName: optionalText,
  driverNameSource: z.enum(["MANUAL", "IMAGE_TRANSLITERATED", "SYSTEM_GENERATED", "UNKNOWN"]).optional(),
  driverNameSourceDetail: optionalText,
  confirmDriverName: z.boolean().optional(),
});

export async function GET(request: NextRequest, { params }: Params) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  const { id } = await params;
  return success(await getDriverDetails(id));
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!hasTeamAccess(request)) return failure("UNAUTHORIZED", "请先登录工作台。", undefined, 401);
  const { id } = await params;
  try { return success(await saveDriverDetails(id, driverDetailsInput.parse(await request.json()))); }
  catch (error) {
    if (error instanceof z.ZodError) return failure("INVALID_DRIVER_DETAILS", "司机资料格式不正确。", undefined, 422);
    const code = error instanceof Error ? error.message : "";
    if (code === "ORDER_NOT_FOUND") return failure("ORDER_NOT_FOUND", "订单不存在。", undefined, 404);
    if (code === "ORDER_CANCELLED") return failure("ORDER_CANCELLED", "订单已取消，不能再确认司机资料。", undefined, 409);
    if (code === "ORDER_CHANGED") return failure("ORDER_CHANGED", "订单状态刚刚发生变化，请刷新后重试。", undefined, 409);
    return failure("DRIVER_DETAILS_SAVE_FAILED", "司机资料保存失败。", undefined, 500);
  }
}
