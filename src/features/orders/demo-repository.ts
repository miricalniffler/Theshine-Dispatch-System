import type { DashboardSummary, Order, OrderFilters } from "./types";

function isoDate(offset: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

const demoOrders: Order[] = [
  { id: "ord_001", orderNo: "IW-20260723-001", serviceDate: isoDate(0), pickupTime: "08:30", city: "曼谷", fleetName: "Bangkok Premier Fleet", passengerName: "张小雨", passengerPhone: "+86 138 0013 8000", route: "BKK Airport → Grande Centre Point", vehicleType: "SUV", status: "READY_TO_DISPATCH", exceptions: ["DUE_SOON"], createdAt: new Date().toISOString() },
  { id: "ord_002", orderNo: "IW-20260723-002", serviceDate: isoDate(0), pickupTime: "11:15", city: "苏梅", fleetName: "Samui Island Transfer", passengerName: "Wang Chen", passengerPhone: "+86 139 0000 1212", route: "USM Airport → W Koh Samui", vehicleType: "Van", status: "PENDING_REVIEW", exceptions: ["MISSING_FIELD"], createdAt: new Date().toISOString() },
  { id: "ord_003", orderNo: "IW-20260724-003", serviceDate: isoDate(1), pickupTime: "06:20", city: "曼谷", fleetName: "Bangkok Premier Fleet", passengerName: "刘先生", passengerPhone: "+86 136 1200 9001", route: "Sukhumvit 24 → BKK Airport", vehicleType: "Sedan", status: "READY_TO_DISPATCH", exceptions: [], createdAt: new Date().toISOString() },
  { id: "ord_004", orderNo: "IW-20260724-004", serviceDate: isoDate(1), pickupTime: "14:40", city: "苏梅", fleetName: "Samui Island Transfer", passengerName: "林思妍", passengerPhone: "+86 135 5555 7788", route: "USM Airport → Chaweng Regent", vehicleType: "SUV", status: "DISPATCHED", exceptions: [], createdAt: new Date().toISOString() },
  { id: "ord_005", orderNo: "IW-20260725-005", serviceDate: isoDate(2), pickupTime: "10:00", city: "曼谷", fleetName: "Siam Airport Service", passengerName: "陈宇", passengerPhone: "+86 131 8822 1033", route: "DMK Airport → The Standard Bangkok", vehicleType: "Van", status: "PENDING_REVIEW", exceptions: ["DUPLICATE_SUSPECT"], createdAt: new Date().toISOString() },
  { id: "ord_006", orderNo: "IW-20260728-006", serviceDate: isoDate(5), pickupTime: "19:30", city: "曼谷", fleetName: "Bangkok Premier Fleet", passengerName: "赵凡", passengerPhone: "+86 186 1000 8877", route: "BKK Airport → Riverside Hotel", vehicleType: "SUV", status: "DRIVER_CONFIRMED", exceptions: [], createdAt: new Date().toISOString() },
  { id: "ord_007", orderNo: "IW-20260730-007", serviceDate: isoDate(7), pickupTime: "09:00", city: "苏梅", fleetName: "Samui Island Transfer", passengerName: "孙悦", passengerPhone: "+86 130 9988 1100", route: "Fisherman’s Village → USM Airport", vehicleType: "Sedan", status: "COMPLETED", exceptions: [], createdAt: new Date().toISOString() },
];

export interface OrderRepository {
  list(filters?: OrderFilters): Promise<Order[]>;
  getSummary(filters?: OrderFilters): Promise<DashboardSummary>;
  getById(id: string): Promise<Order | undefined>;
  getByIds(ids: string[]): Promise<Order[]>;
  updateStatus(id: string, status: Order["status"]): Promise<Order | undefined>;
  create(order: Order): Promise<Order>;
}

function matches(order: Order, filters: OrderFilters) {
  const today = isoDate(0);
  if (filters.dateMode === "today" && order.serviceDate !== today) return false;
  if (filters.dateMode === "future" && order.serviceDate < today) return false;
  if (filters.dateMode === "range") {
    if (filters.startDate && order.serviceDate < filters.startDate) return false;
    if (filters.endDate && order.serviceDate > filters.endDate) return false;
  }
  if (filters.city && order.city !== filters.city) return false;
  if (filters.fleet && order.fleetName !== filters.fleet) return false;
  if (filters.status && order.status !== filters.status) return false;
  if (filters.exception && !order.exceptions.includes(filters.exception as Order["exceptions"][number])) return false;
  if (filters.keyword) {
    const phrase = filters.keyword.toLowerCase();
    const text = [order.orderNo, order.passengerName, order.passengerPhone, order.route].join(" ").toLowerCase();
    if (!text.includes(phrase)) return false;
  }
  return true;
}

export const demoOrderRepository: OrderRepository = {
  async list(filters = {}) {
    return demoOrders.filter((order) => matches(order, filters)).sort((a, b) => `${a.serviceDate}${a.pickupTime}`.localeCompare(`${b.serviceDate}${b.pickupTime}`));
  },
  async getSummary(filters = {}) {
    const orders = await this.list(filters);
    return {
      total: orders.length,
      pendingReview: orders.filter((order) => order.status === "PENDING_REVIEW").length,
      readyToDispatch: orders.filter((order) => order.status === "READY_TO_DISPATCH").length,
      dispatched: orders.filter((order) => order.status === "DISPATCHED").length,
      exceptions: orders.filter((order) => order.exceptions.length > 0).length,
    };
  },
  async getById(id) { return demoOrders.find((order) => order.id === id); },
  async getByIds(ids) { return demoOrders.filter((order) => ids.includes(order.id)); },
  async updateStatus(id, status) {
    const order = demoOrders.find((item) => item.id === id);
    if (order) order.status = status;
    return order;
  },
  async create(order) { demoOrders.unshift(order); return order; },
};

export function queryToFilters(params: URLSearchParams): OrderFilters {
  return {
    dateMode: (params.get("dateMode") as OrderFilters["dateMode"]) || "today",
    startDate: params.get("startDate") || undefined,
    endDate: params.get("endDate") || undefined,
    city: params.get("city") || undefined,
    fleet: params.get("fleet") || undefined,
    status: params.get("status") || undefined,
    exception: params.get("exception") || undefined,
    keyword: params.get("keyword") || undefined,
  };
}
