import { normalizeVehicleModel } from "@/lib/rules/engine";
import { loadRules } from "@/lib/rules/load-rules";
import type { RulesConfig } from "@/lib/rules/types";

type DriverDetailWithVehicleModel = {
  confirmedVehicleModel: string | null;
};

/**
 * Normalizes a saved driver detail only for presentation. This keeps older
 * records compatible when the vehicle catalogue gains a new reliable alias,
 * without changing operational data or creating reassignment history.
 */
export function driverDetailForDisplay<T extends DriverDetailWithVehicleModel>(
  detail: T,
  rules: RulesConfig = loadRules(),
): T {
  const confirmedVehicleModel = normalizeVehicleModel(
    detail.confirmedVehicleModel,
    rules,
  );

  if (confirmedVehicleModel === detail.confirmedVehicleModel) return detail;

  return { ...detail, confirmedVehicleModel };
}
