import { db } from "@/lib/db";
import { pullConnectorMessages, type ImportedMessage } from "./connectors";
import { canonicalFleetForCity } from "@/features/fleets/canonical-fleets";

type SyncSummary = { runId: string; created: number; updated: number; cancelled: number; skipped: number };

function pick(text: string, label: string) {
  return text.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1]?.trim() || "";
}

function orderNumber(message: ImportedMessage) {
  return pick(message.text, "(?:Order Number|Order ID)") || message.subject?.match(/#(\d+)/)?.[1] || "";
}

function dateTime(value: string) {
  const match = value.match(/(\d{4}-\d{2}-\d{2})[^0-9]*(\d{2}:\d{2})?/);
  if (!match) return null;
  return { serviceDate: match[1], time: match[2] ?? "00:00", date: new Date(`${match[1]}T${match[2] ?? "00:00"}:00+07:00`) };
}

function receivedAt(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberFrom(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function meetGreetFor(text: string) {
  const signName = pick(text, "(?:Meeting tablet|Greeting sign|Meeting sign|Meet(?:ing)?&?Greet)");
  return signName || (/meet\s*&?\s*greet|举牌/i.test(text) ? "Meet&Greet" : null);
}

async function recordMessage(message: ImportedMessage, orderId?: string) {
  await db.importedSourceMessage.create({ data: { connector: "feishu-mail", externalId: message.id, action: message.action, sourceText: message.text, orderId, receivedAt: receivedAt(message.receivedAt) } });
}

async function applyMessage(message: ImportedMessage): Promise<"created" | "updated" | "cancelled" | "skipped"> {
  const externalId = message.id.trim();
  if (!externalId || await db.importedSourceMessage.findUnique({ where: { connector_externalId: { connector: "feishu-mail", externalId } } })) return "skipped";
  const platformOrderNumber = orderNumber(message);
  if (!platformOrderNumber) { await recordMessage(message); return "skipped"; }
  const existing = await db.order.findUnique({ where: { platformOrderNumber } });
  if (message.action === "cancel") {
    if (!existing) { await recordMessage(message); return "skipped"; }
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: existing.id }, data: { status: "CANCELLED", rawSource: message.text } });
      await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：订单已取消", actor: "系统定时任务", metadata: `邮件：${message.id}` } });
    });
    await recordMessage(message, existing.id);
    return "cancelled";
  }
  const pickup = dateTime(pick(message.text, "(?:Departure Time|Pickup Time)"));
  const passengerName = pick(message.text, "Passenger Name");
  const passengerPhone = pick(message.text, "(?:Passenger Phone Number|Phone)");
  const pickupAddress = pick(message.text, "Pickup address");
  const dropoffAddress = pick(message.text, "Dropoff address");
  const platformVehicleType = pick(message.text, "Vehicle Type");
  if (!pickup || !passengerName || !passengerPhone || !pickupAddress || !dropoffAddress || !platformVehicleType) { await recordMessage(message, existing?.id); return "skipped"; }
  const city = /samui|苏梅|USM/i.test(`${pickupAddress} ${dropoffAddress}`) ? "苏梅" : "曼谷";
  const adults = numberFrom(pick(message.text, "(?:Adults|Number of passengers)"));
  const children = numberFrom(pick(message.text, "Children"));
  const statedLuggage = pick(message.text, "(?:Luggage|Number of luggage|Baggage)");
  const data = { city, serviceDate: pickup.serviceDate, pickupDateTime: pickup.date, passengerName, passengerPhone, pickupAddress, dropoffAddress, platformVehicleType, flightNumber: pick(message.text, "Flight Number") || null, adults, children, luggage: statedLuggage ? numberFrom(statedLuggage) : adults + children, meetGreetLine: meetGreetFor(message.text), rawSource: message.text };
  if (existing) {
    await db.$transaction(async (tx) => {
      const fleet = await canonicalFleetForCity(tx, city);
      await tx.order.update({ where: { id: existing.id }, data: { ...data, fleetId: fleet.id } });
      await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：订单已更新", actor: "系统定时任务", metadata: `邮件：${message.id}` } });
    });
    await recordMessage(message, existing.id);
    return "updated";
  }
  const fleet = await canonicalFleetForCity(db, city);
  const created = await db.order.create({ data: { platformOrderNumber, ...data, fleetId: fleet.id, status: "READY_TO_DISPATCH" } });
  await db.activityLog.create({ data: { orderId: created.id, action: "飞书邮件同步：新增订单", actor: "系统定时任务", metadata: `邮件：${message.id}` } });
  await recordMessage(message, created.id);
  return "created";
}

export async function runFeishuMailSync(): Promise<SyncSummary> {
  const run = await db.importSyncRun.create({ data: { connector: "feishu-mail", status: "RUNNING" } });
  try {
    const { items } = await pullConnectorMessages("feishu-mail", { allowEmpty: true });
    const summary = { created: 0, updated: 0, cancelled: 0, skipped: 0 };
    for (const item of items) summary[await applyMessage(item)] += 1;
    await db.importSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", completedAt: new Date(), createdCount: summary.created, updatedCount: summary.updated, cancelledCount: summary.cancelled, skippedCount: summary.skipped } });
    return { runId: run.id, ...summary };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知同步错误";
    await db.importSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), errorMessage } });
    throw error;
  }
}

export async function getFeishuSyncStatus() {
  return db.importSyncRun.findFirst({ where: { connector: "feishu-mail" }, orderBy: { startedAt: "desc" } });
}
