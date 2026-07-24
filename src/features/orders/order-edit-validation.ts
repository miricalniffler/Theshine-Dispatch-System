import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((value) => value || null);

export const orderEditSchema = z.object({
  platformOrderNumber: z.string().trim().min(1, "请填写平台订单号").max(100),
  city: z.enum(["曼谷", "苏梅"], { message: "请选择服务城市" }),
  fleetId: z.string().trim().min(1).optional().nullable().transform((value) => value || null),
  pickupDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "请填写有效的接客日期和时间").refine((value) => !Number.isNaN(new Date(`${value}:00+07:00`).getTime()), "请填写有效的接客日期和时间"),
  pickupAddress: z.string().trim().min(1, "请填写上车地点").max(500),
  dropoffAddress: z.string().trim().min(1, "请填写下车地点").max(500),
  passengerName: z.string().trim().min(1, "请填写乘客姓名").max(120),
  passengerPhone: z.string().trim().min(1, "请填写乘客电话").max(80),
  flightNumber: optionalText(80),
  platformVehicleType: z.string().trim().min(1, "请填写平台车型").max(80),
  seatCount: z.coerce.number().int().min(0).max(99).optional().nullable(),
  adults: z.coerce.number().int().min(0).max(99),
  children: z.coerce.number().int().min(0).max(99),
  luggage: z.coerce.number().int().min(0).max(99),
  childSeatLine: optionalText(300),
  meetGreetLine: optionalText(300),
  otherNotes: optionalText(1000),
});

export type OrderEditInput = z.infer<typeof orderEditSchema>;
export const toBangkokDate = (value: string) => new Date(`${value}:00+07:00`);
