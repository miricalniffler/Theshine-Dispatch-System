import { Fleet, FleetInput } from "./types";

const initialFleets: Fleet[] = [
  { id: "fleet-bkk-01", name: "Siam Airport Transfer", city: "曼谷", chatNote: "WhatsApp：Siam Dispatch", vehicleTypes: ["Sedan", "SUV", "Van"], note: "凌晨订单请提前 2 小时确认", enabled: true, updatedAt: "2026-07-23T08:30:00.000Z" },
  { id: "fleet-bkk-02", name: "Bangkok Ride Team", city: "曼谷", chatNote: "微信：曼谷接送机调度群", vehicleTypes: ["Sedan", "Van"], note: "", enabled: true, updatedAt: "2026-07-22T16:20:00.000Z" },
  { id: "fleet-usm-01", name: "Samui Island Fleet", city: "苏梅", chatNote: "WhatsApp：Samui Operations", vehicleTypes: ["Sedan", "SUV", "Van"], note: "旺季优先安排 Van", enabled: false, updatedAt: "2026-07-21T09:15:00.000Z" },
];

// 第一期开发表现层的内存仓库。替换为数据库时，只需保持这些方法的返回结构。
let fleets = [...initialFleets];

export const fleetRepository = {
  list(city?: string) {
    return city && city !== "全部城市" ? fleets.filter((fleet) => fleet.city === city) : fleets;
  },
  get(id: string) { return fleets.find((fleet) => fleet.id === id); },
  create(input: FleetInput) {
    const fleet: Fleet = { ...input, id: `fleet-${crypto.randomUUID()}`, updatedAt: new Date().toISOString() };
    fleets = [fleet, ...fleets];
    return fleet;
  },
  update(id: string, patch: Partial<FleetInput>) {
    const current = this.get(id);
    if (!current) return undefined;
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    fleets = fleets.map((fleet) => fleet.id === id ? updated : fleet);
    return updated;
  },
};
