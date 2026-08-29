import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function normalizedText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function capture(text, pattern) {
  return normalizedText(text.match(pattern)?.[1] || "");
}

function platformVehicleLabel(vehicleClass, modelCars) {
  const category = normalizedText(vehicleClass).split("(")[0].trim();
  if (!/^[A-Z]\d?$/i.test(category)) return category;
  const model = normalizedText(modelCars).split(/,\s*\d+\.\s*/)[0]
    .replace(/^\d+\.\s*/, "")
    .replace(/\(\s*(?:\d+\s*)?(?:seats?|pax)\s*[-:]\s*\d+\s*\)/gi, "")
    .replace(/\(?\s*\d+\s*(?:seats?|pax)\s*[-:]\s*\d+\s*\)?/gi, "")
    .replace(/\s*(?:,|;|-)?\s*(?:seats?|pax)\b.*$/i, "")
    .replace(/[\s,;:-]+$/, "")
    .trim();
  return model || "待核对";
}

try {
  const orders = await db.order.findMany({
    select: { id: true, platformOrderNumber: true, platformVehicleType: true, rawSource: true },
  });
  const repaired = [];
  for (const order of orders) {
    if (!/^(?:[A-Z]\d?|\d+\.\s)/i.test(order.platformVehicleType.trim())) continue;
    const text = normalizedText(order.rawSource);
    const vehicleClass = capture(text, /Vehicle Class:\s*(.*?)\s+Model cars:/i);
    const modelCars = capture(text, /Model cars:\s*(.*?)\s+Pax:/i);
    const vehicleType = platformVehicleLabel(vehicleClass, modelCars);
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
