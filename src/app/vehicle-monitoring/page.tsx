import { listVehicleMonitoring } from "@/features/vehicle-monitoring/assessment-service";
import { listVehicleStandards } from "@/features/vehicle-monitoring/standards-service";
import { VehicleMonitoringWorkbench } from "@/features/vehicle-monitoring/VehicleMonitoringWorkbench";

export const dynamic = "force-dynamic";

export default async function VehicleMonitoringPage() {
  const [orders, standards] = await Promise.all([listVehicleMonitoring(), listVehicleStandards()]);
  const initial = orders.map((order) => ({ id: order.id, orderNo: order.platformOrderNumber, pickupAt: order.pickupDateTime.toISOString(), platformGrade: order.platformVehicleType, country: order.serviceCountry, passengers: order.adults + order.children, luggage: order.luggage, luggageSource: order.luggageSource, vehicle: order.driverDetail?.confirmedVehicleModel ?? null, status: order.vehicleAssessments[0]?.status ?? "REVIEW_REQUIRED", reason: order.vehicleAssessments[0]?.reason ?? "尚未生成审核", override: Boolean(order.vehicleOverrides[0]) }));
  return <VehicleMonitoringWorkbench initial={initial} standardCount={standards.length} />;
}
