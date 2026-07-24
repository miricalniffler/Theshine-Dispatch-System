export const ORDER_STATUSES = [
  "PENDING_DISPATCH",
  "DISPATCHED",
  "DRIVER_DETAILS_PENDING",
  "READY_FOR_IWAY_RETURN",
  "COMPLETED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderRecord = {
  id: string;
  platformOrderNumber: string;
  city: string;
  fleetId: string | null;
  serviceDate: string;
  pickupDateTime: Date;
  pickupAddress: string;
  dropoffAddress: string;
  passengerName: string;
  passengerPhone: string;
  flightNumber: string | null;
  platformVehicleType: string;
  seatCount: number | null;
  adults: number;
  children: number;
  luggage: number;
  childSeatLine: string | null;
  meetGreetLine: string | null;
  otherNotes: string | null;
  status: OrderStatus;
};

export type DriverDetailsInput = {
  confirmedDriverName?: string | null;
  rawDriverPhone?: string | null;
  confirmedVehicleModel?: string | null;
  licensePlate?: string | null;
};

export type TemplateContext = Record<string, string | number | boolean | null | undefined>;

export type FieldValidationResult = {
  valid: boolean;
  missingFields: string[];
};

export type ApiSuccess<T> = { data: T };
export type ApiFailure = { error: { code: string; message: string; fields?: string[] } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
