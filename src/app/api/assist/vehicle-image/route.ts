import { failure, success } from "@/lib/api-response";
import { identifyVehicleFromImage } from "@/features/assist/service";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.imageUrl !== "string") return failure("INVALID_REQUEST", "请提供车辆图片地址。", undefined, 422);
  return success(await identifyVehicleFromImage(body.imageUrl));
}
