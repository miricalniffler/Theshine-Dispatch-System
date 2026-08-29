import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function normalizedText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function capture(text, pattern) {
  return normalizedText(text.match(pattern)?.[1] || "");
}

function platformVehicleLabel(vehicleClass) {
  const category = normalizedText(vehicleClass).split("(")[0].trim();
  if (/^C$/i.test(category)) return "COMFORT";
  return category;
}

try {
  const orders = await db.order.findMany({
    select: { id: true, platformOrderNumber: true, platformVehicleType: true, rawSource: true },
  });
  const repaired = [];
  for (const order of orders) {
    if (!/^(?:C|Toyota Corolla)$/i.test(order.platformVehicleType.trim())) continue;
    const text = normalizedText(order.rawSource);
    const vehicleClass = capture(text, /Vehicle Class:\s*(.*?)\s+Model cars:/i);
    const vehicleType = platformVehicleLabel(vehicleClass);
    if (!vehicleType || vehicleType === order.platformVehicleType) continue;
    await db.$transaction([
      db.order.update({ where: { id: order.id }, data: { platformVehicleType: vehicleType } }),
      db.activityLog.create({ data: { orderId: order.id, action: "修复 i’way 内部车型代码", actor: "系统修复", metadata: `车型 ${order.platformVehicleType} → ${vehicleType}` } }),
    ]);
    repaired.push({ orderNo: order.platformOrderNumber, vehicleType });
  }
  console.log(JSON.stringify({ repairedCount: repaired.length, repaired }, null, 2));
} finally {
  await db.$disconnect();
}
