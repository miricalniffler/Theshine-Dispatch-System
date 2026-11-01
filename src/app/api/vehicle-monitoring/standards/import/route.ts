import { failure, success } from "@/lib/api-response";
import { importInitialVehicleStandards } from "@/features/vehicle-monitoring/standards-service";

export async function POST() {
  try { return success(await importInitialVehicleStandards()); }
  catch (error) { return failure("STANDARD_IMPORT_FAILED", error instanceof Error ? error.message : "初始车型标准导入失败。", undefined, 500); }
}
