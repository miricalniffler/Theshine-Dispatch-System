import { db } from "@/lib/db";
import { failure, success } from "@/lib/api-response";
import { NextRequest } from "next/server";
import { canonicalFleetForCity } from "@/features/fleets/canonical-fleets";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const fields = body.fields;
  const source = body.source;
  if (!fields || typeof fields.platformOrderNumber !== "string") return failure("INVALID_REQUEST", "缺少确认后的订单字段。", undefined, 422);
  if (!source?.verified || !["iway_feishu", "esforty", "manual"].includes(source.type)) return failure("SOURCE_UNVERIFIED", "订单来源尚未核实，禁止保存。", undefined, 422);
  const required = ["platformOrderNumber", "passengerName", "passengerPhone", "pickupDateTime", "pickupAddress", "dropoffAddress", "platformVehicleType"];
  const missing = required.filter((key) => !fields[key]);
  const existing = await db.order.findUnique({ where: { platformOrderNumber: fields.platformOrderNumber } });
  if (existing && body.duplicateAction !== "keep") return failure("DUPLICATE_ORDER", "该订单号已存在。请查看旧单，不要重复录入。", [existing.id], 409);
  const pickupDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(fields.pickupDateTime)) ? new Date(`${fields.pickupDateTime}:00+07:00`) : null;
  if (!pickupDateTime || Number.isNaN(pickupDateTime.getTime())) return failure("INVALID_PICKUP_TIME", "接客时间无法确认，请返回核对。", ["pickupDateTime"], 422);
  const order = await db.$transaction(async (tx) => {
    const city = fields.city === "苏梅" ? "苏梅" : "曼谷";
    const fleet = await canonicalFleetForCity(tx, city);
    const created = await tx.order.create({ data: { platformOrderNumber: fields.platformOrderNumber, city, fleetId: fleet.id, serviceDate: fields.pickupDateTime.slice(0, 10), pickupDateTime, pickupAddress: fields.pickupAddress || "待核对", dropoffAddress: fields.dropoffAddress || "待核对", passengerName: fields.passengerName || "待核对", passengerPhone: fields.passengerPhone || "待核对", flightNumber: fields.flightNumber || null, platformVehicleType: fields.platformVehicleType || "待核对", adults: Number(fields.adults) || 0, children: Number(fields.children) || 0, luggage: Number(fields.luggage) || 0, otherNotes: fields.otherNotes || null, rawSource: body.rawText || null, status: missing.length ? "PENDING_REVIEW" : "READY_TO_DISPATCH" } });
    await tx.activityLog.create({ data: { orderId: created.id, action: "订单已导入", actor: "运营人员", metadata: JSON.stringify({ sourceType: source.type, sourceFormat: source.format, sourceVerified: true }) } });
    return created;
  });
  return success({ order, message: missing.length ? "订单已保存为待核对。" : "订单已按城市自动分配车队，等待派单。" });
}
