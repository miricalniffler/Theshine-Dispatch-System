import { demoOrderRepository } from "@/features/orders/demo-repository";
import { failure, success } from "@/lib/api-response";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const fields = body.fields;
  if (!fields || typeof fields.platformOrderNumber !== "string") return failure("INVALID_REQUEST", "缺少确认后的订单字段。", undefined, 422);
  const required = ["platformOrderNumber", "passengerName", "passengerPhone", "pickupDateTime", "pickupAddress", "dropoffAddress", "platformVehicleType"];
  const missing = required.filter((key) => !fields[key]);
  const existing = (await demoOrderRepository.list({ dateMode: "future" })).find((order) => order.orderNo.replace(/\s/g, "") === fields.platformOrderNumber.replace(/\s/g, ""));
  if (existing && body.duplicateAction !== "keep") return failure("DUPLICATE_ORDER", "该订单号已存在。请选择查看旧单或明确保留为重复订单。", [existing.id], 409);
  const dateMatch = String(fields.pickupDateTime).match(/(\d{4}-\d{2}-\d{2})[^0-9]*(\d{2}:\d{2})?/);
  const order = await demoOrderRepository.create({ id: `ord_import_${Date.now()}`, orderNo: fields.platformOrderNumber, serviceDate: dateMatch?.[1] || new Date().toISOString().slice(0, 10), pickupTime: dateMatch?.[2] || "待核对", city: fields.city === "苏梅" ? "苏梅" : "曼谷", fleetName: fields.fleetName || "待选择", passengerName: fields.passengerName, passengerPhone: fields.passengerPhone, route: `${fields.pickupAddress} → ${fields.dropoffAddress}`, vehicleType: fields.platformVehicleType, status: missing.length ? "PENDING_REVIEW" : "READY_TO_DISPATCH", exceptions: missing.length ? ["MISSING_FIELD"] : [], createdAt: new Date().toISOString() });
  return success({ order, message: missing.length ? "订单已保存为待核对。" : "订单已保存，等待选择车队派单。" });
}
