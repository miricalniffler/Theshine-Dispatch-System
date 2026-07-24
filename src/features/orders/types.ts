export type OrderStatus = "PENDING_REVIEW" | "READY_TO_DISPATCH" | "DISPATCHED" | "DRIVER_CONFIRMED" | "RETURNED" | "COMPLETED";
export type OrderException = "MISSING_FIELD" | "DUPLICATE_SUSPECT" | "DUE_SOON";

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
  exceptions: OrderException[];
  createdAt: string;
};

export type OrderFilters = {
  dateMode?: "window" | "today" | "tomorrow" | "future" | "month" | "range";
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
  pendingReview: number;
  readyToDispatch: number;
  dispatched: number;
  pendingDriver: number;
  pendingReturn: number;
  exceptions: number;
};
