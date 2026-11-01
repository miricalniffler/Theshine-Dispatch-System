import { success } from "@/lib/api-response";
import { listVehicleMonitoring } from "@/features/vehicle-monitoring/assessment-service";
import { listVehicleStandards } from "@/features/vehicle-monitoring/standards-service";

export async function GET() {
  const [orders, standards] = await Promise.all([listVehicleMonitoring(), listVehicleStandards()]);
  return success({ orders, standards });
}
