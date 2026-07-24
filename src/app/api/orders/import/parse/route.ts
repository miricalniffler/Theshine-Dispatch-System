import { failure, success } from "@/lib/api-response";
import { identifyVehicleFromImage, translateThaiForReview } from "@/features/assist/service";
import { demoOrderRepository } from "@/features/orders/demo-repository";
import { NextRequest } from "next/server";

function pick(text: string, label: string) { return text.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1]?.trim() || ""; }

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.text !== "string" || !body.text.trim()) return failure("EMPTY_SOURCE", "请粘贴订单原文。", undefined, 422);
  if (body.vehicleImageUrl !== undefined && typeof body.vehicleImageUrl !== "string") return failure("INVALID_REQUEST", "车辆图片地址格式不正确。", undefined, 422);
  const text = body.text;
  const result = { platformOrderNumber: pick(text, "(?:Order Number|Order ID)"), passengerName: pick(text, "Passenger Name"), passengerPhone: pick(text, "(?:Passenger Phone Number|Phone)"), pickupDateTime: pick(text, "(?:Departure Time|Pickup Time)"), pickupAddress: pick(text, "Pickup address"), dropoffAddress: pick(text, "Dropoff address"), platformVehicleType: pick(text, "Vehicle Type"), flightNumber: pick(text, "Flight Number") };
  const missing = Object.entries(result).filter(([key, value]) => !value && key !== "flightNumber").map(([key]) => key);
  const orders = await demoOrderRepository.list({ dateMode: "future" });
  const exact = orders.filter((order) => order.orderNo.replace(/\s/g, "") === result.platformOrderNumber.replace(/\s/g, ""));
  const suspected = orders.filter((order) => !exact.includes(order) && result.passengerName && order.passengerName.toLowerCase() === result.passengerName.toLowerCase());
  const [thaiTranslation, vehicleImage] = await Promise.all([translateThaiForReview(text), identifyVehicleFromImage(body.vehicleImageUrl || "")]);
  return success({ fields: result, missingFields: missing, rawText: text, status: missing.length ? "PENDING_REVIEW" : "READY_TO_DISPATCH", duplicates: { exact: exact.map((order) => ({ id: order.id, orderNo: order.orderNo })), suspected: suspected.map((order) => ({ id: order.id, orderNo: order.orderNo, reason: "乘客姓名相同，请人工核对服务时间和路线" })) }, assistance: { thaiTranslation, vehicleImage } });
}
