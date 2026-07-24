export const fleetCities = ["曼谷", "苏梅"] as const;
export type FleetCity = (typeof fleetCities)[number];

export type Fleet = {
  id: string;
  name: string;
  city: FleetCity;
  chatNote: string;
  vehicleTypes: string[];
  note: string;
  enabled: boolean;
  updatedAt: string;
};

export type FleetInput = Omit<Fleet, "id" | "updatedAt">;
