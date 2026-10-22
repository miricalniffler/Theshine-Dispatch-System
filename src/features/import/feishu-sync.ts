import { db } from "@/lib/db";
import { pullConnectorMessages, type ImportedMessage } from "./connectors";
import { canonicalFleetForCity } from "@/features/fleets/canonical-fleets";
import { detectDispatchCity } from "@/lib/city/detect-city";

export type SyncSummary = { runId: string; created: number; updated: number; cancelled: number; skipped: number };

const staleRunMs = 5 * 60_000;
let activeFeishuMailSync: Promise<SyncSummary> | null = null;

export class FeishuMailSyncInProgressError extends Error {
  constructor(public readonly runId: string) {
    super("飞书邮件同步正在进行中，请等待当前同步完成。");
    this.name = "FeishuMailSyncInProgressError";
  }
}

function pick(text: string, label: string) {
  return text.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1]?.trim() || "";
}

function phoneFrom(value: string) {
  const normalised = value.replace(/[–—]/g, "-");
  const match = normalised.match(/(?:\+?\d[\d\s()\-]{5,}\d)/);
  return match?.[0]?.replace(/\s+/g, " ").trim() || "";
}

function addressFrom(value: string) {
  return value
    .replace(/\s+(?:rent\s+a\s+vehicle|intercity|waiting\s+time|child\s+seat|extra\s+services?)\s*:[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
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
    const cancelled = await db.$transaction(async (tx) => {
      // Never let a delayed external cancellation overwrite a terminal
      // business state, or duplicate a local cancellation audit record.
      if (existing.status === "COMPLETED" || existing.status === "CANCELLED") return false;
      const changed = await tx.order.updateMany({ where: { id: existing.id, status: existing.status }, data: { status: "CANCELLED", rawSource: message.text } });
      if (!changed.count) return false;
      await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：订单已取消", actor: "系统定时任务", metadata: JSON.stringify({ messageId: message.id, previousStatus: existing.status }) } });
      return true;
    });
    await recordMessage(message, existing.id);
    return cancelled ? "cancelled" : "skipped";
  }
  const pickup = dateTime(pick(message.text, "(?:Departure Time|Pickup Time)"));
  const passengerName = pick(message.text, "Passenger Name");
  const passengerPhone = phoneFrom(pick(message.text, "(?:Passenger Phone Number|Phone)"));
  const pickupAddress = addressFrom(pick(message.text, "Pickup address"));
  const dropoffAddress = addressFrom(pick(message.text, "Dropoff address"));
  const platformVehicleType = pick(message.text, "Vehicle Type");
  if (!pickup || !passengerName || !passengerPhone || !pickupAddress || !dropoffAddress || !platformVehicleType) { await recordMessage(message, existing?.id); return "skipped"; }
  const cityDetection = detectDispatchCity(pickupAddress, dropoffAddress);
  const city = cityDetection.city;
  const adults = numberFrom(pick(message.text, "(?:Adults|Number of passengers)"));
  const children = numberFrom(pick(message.text, "Children"));
  const statedLuggage = pick(message.text, "(?:Luggage|Number of luggage|Baggage)");
  const data = { serviceDate: pickup.serviceDate, pickupDateTime: pickup.date, passengerName, passengerPhone, pickupAddress, dropoffAddress, platformVehicleType, flightNumber: pick(message.text, "Flight Number") || null, adults, children, luggage: statedLuggage ? numberFrom(statedLuggage) : adults + children, meetGreetLine: meetGreetFor(message.text), rawSource: message.text };
  if (existing) {
    const updated = await db.$transaction(async (tx) => {
      // An externally cancelled order requires an explicit external restore
      // signal; a regular update must not silently reopen or overwrite it.
      if (existing.status === "CANCELLED") {
        await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：已忽略取消订单更新", actor: "系统定时任务", metadata: `邮件：${message.id}` } });
        return false;
      }
      const fleet = city ? await canonicalFleetForCity(tx, city) : null;
      await tx.order.update({ where: { id: existing.id }, data: city ? { ...data, city, fleetId: fleet!.id } : data });
      await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：订单已更新", actor: "系统定时任务", metadata: `邮件：${message.id}；城市判断：${cityDetection.reason}` } });
      return true;
    });
    await recordMessage(message, existing.id);
    return updated ? "updated" : "skipped";
  }
  const fleet = city ? await canonicalFleetForCity(db, city) : null;
  const created = await db.order.create({ data: { platformOrderNumber, ...data, city: city ?? "待确认", fleetId: fleet?.id ?? null, status: city ? "READY_TO_DISPATCH" : "PENDING_REVIEW" } });
  await db.activityLog.create({ data: { orderId: created.id, action: "飞书邮件同步：新增订单", actor: "系统定时任务", metadata: `邮件：${message.id}；城市判断：${cityDetection.reason}` } });
  await recordMessage(message, created.id);
  return "created";
}

async function startFeishuMailSync(): Promise<SyncSummary> {
  const staleBefore = new Date(Date.now() - staleRunMs);
  await db.importSyncRun.updateMany({
    where: { connector: "feishu-mail", status: "RUNNING", startedAt: { lt: staleBefore } },
    data: { status: "FAILED", completedAt: new Date(), errorMessage: "飞书同步超过 5 分钟未完成，已自动释放；请重新同步。" },
  });
  const running = await db.importSyncRun.findFirst({
    where: { connector: "feishu-mail", status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  if (running) throw new FeishuMailSyncInProgressError(running.id);

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

export async function runFeishuMailSync(): Promise<SyncSummary> {
  if (activeFeishuMailSync) throw new FeishuMailSyncInProgressError("当前服务实例");
  const sync = startFeishuMailSync();
  activeFeishuMailSync = sync;
  try {
    return await sync;
  } finally {
    if (activeFeishuMailSync === sync) activeFeishuMailSync = null;
  }
}

export async function getFeishuSyncStatus() {
  return db.importSyncRun.findFirst({ where: { connector: "feishu-mail" }, orderBy: { startedAt: "desc" } });
}
