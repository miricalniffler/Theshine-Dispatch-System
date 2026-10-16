export type OrderStatus = "PENDING_REVIEW" | "READY_TO_DISPATCH" | "DISPATCHED" | "DRIVER_CONFIRMED" | "RETURNED" | "COMPLETED" | "CANCELLED";
export type OrderException = string;

export type Order = {
  id: string;
  orderNo: string;
  serviceDate: string;
  pickupTime: string;
  city: "曼谷" | "苏梅";
  fleetName: string;
  passengerName: string;
  passengerPhone: string;
  route: string;
  vehicleType: string;
  status: OrderStatus;
  cancelReason?: string | null;
  cancelledAt?: string | null;
  restoreBlockedReason?: string | null;
  exceptions: OrderException[];
  createdAt: string;
  driverDetail?: {
    confirmedDriverName: string | null;
    normalizedDriverPhone: string | null;
    confirmedVehicleModel: string | null;
    licensePlate: string | null;
  } | null;
};

export type OrderFilters = {
  dateMode?: "all" | "window" | "today" | "tomorrow" | "future" | "month" | "range";
  startDate?: string;
  endDate?: string;
  city?: string;
  fleet?: string;
  status?: string;
  exception?: string;
  keyword?: string;
};

export type DashboardSummary = {
  total: number;
  waitingFleetReply: number;
  incompleteDriver: number;
  readyIwayReturn: number;
  exceptions: number;
};
