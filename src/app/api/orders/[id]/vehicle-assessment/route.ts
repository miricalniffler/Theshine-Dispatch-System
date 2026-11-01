import { failure, success } from "@/lib/api-response";
import { reassessOrder, releaseOrderVehicle } from "@/features/vehicle-monitoring/assessment-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "release") return success({ override: await releaseOrderVehicle(id, typeof body.reason === "string" ? body.reason : "") });
    return success({ assessment: await reassessOrder(id, "MANUAL_REVIEW") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "车型审核失败。";
    return failure(message === "OVERRIDE_REASON_REQUIRED" ? message : "VEHICLE_ASSESSMENT_FAILED", message === "OVERRIDE_REASON_REQUIRED" ? "单次放行必须填写原因。" : message, undefined, message === "ORDER_NOT_FOUND" ? 404 : 422);
  }
}
