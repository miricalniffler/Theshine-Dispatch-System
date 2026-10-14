import { failure, success } from "@/lib/api-response";
import { findVehicleArchive, saveVehicleArchive } from "@/features/vehicles/archive-service";
import { z } from "zod";
import { NextRequest } from "next/server";

const input = z.object({
  rawPlate: z.string().min(1).max(80), brand: z.string().max(80).optional().nullable(),
  model: z.string().max(120).optional().nullable(), vehicleClass: z.string().max(80).optional().nullable(),
  driverName: z.string().max(120).optional().nullable(), normalizedPhone: z.string().max(40).optional().nullable(),
  source: z.enum(["MANUAL_CONFIRMATION", "ORDER_DRIVER_CONFIRMATION", "AI_SUGGESTION"]), replaceConfirmed: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const plate = request.nextUrl.searchParams.get("plate") ?? "";
  return success(await findVehicleArchive(plate));
}

export async function POST(request: NextRequest) {
  try { return success(await saveVehicleArchive(input.parse(await request.json()))); }
  catch (error) {
    if (error instanceof z.ZodError) return failure("INVALID_VEHICLE_ARCHIVE", "车辆档案资料格式不正确。", undefined, 400);
    if (error instanceof Error && error.message === "PLATE_REQUIRED") return failure("PLATE_REQUIRED", "请填写车牌号。", undefined, 400);
    return failure("VEHICLE_ARCHIVE_SAVE_FAILED", "车辆档案暂时无法保存。", undefined, 500);
  }
}
