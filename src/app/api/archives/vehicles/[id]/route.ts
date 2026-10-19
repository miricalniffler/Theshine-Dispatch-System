import { failure, success } from "@/lib/api-response";
import { updateVehicleProfile } from "@/features/archives/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    return success(await updateVehicleProfile((await params).id, body));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return failure(code || "VEHICLE_UPDATE_FAILED", code === "VEHICLE_PLATE_CONFLICT" ? "该规范化车牌已存在于另一份车辆档案，请先人工核对。" : "无法更新车辆档案。", undefined, 422);
  }
}
