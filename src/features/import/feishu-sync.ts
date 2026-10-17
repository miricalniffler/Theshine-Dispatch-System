import { db } from "@/lib/db";
import { pullConnectorMessages, type ImportedMessage } from "./connectors";
import { canonicalFleetForCity } from "@/features/fleets/canonical-fleets";
import { invalidatePendingIwayBatches } from "@/features/iway/invalidate-pending-batches";
import { detectDispatchCity } from "@/lib/city/detect-city";
import { decideFeishuUpdate } from "./feishu-sync-policy";

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

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Claims a source message before changing an order.  The external message id
 * is unique in the database, so this is also the cross-instance idempotency
 * guard when two cron/manual requests arrive together.
 */
async function claimMessage(message: ImportedMessage) {
  try {
    await db.importedSourceMessage.create({
      data: { connector: "feishu-mail", externalId: message.id, action: message.action, sourceText: message.text, receivedAt: receivedAt(message.receivedAt) },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

async function linkClaimedMessage(message: ImportedMessage, orderId?: string) {
  await db.importedSourceMessage.update({
    where: { connector_externalId: { connector: "feishu-mail", externalId: message.id } },
    data: { orderId },
  });
}

async function releaseClaim(message: ImportedMessage) {
  await db.importedSourceMessage.deleteMany({ where: { connector: "feishu-mail", externalId: message.id } });
}

async function applyMessage(message: ImportedMessage): Promise<"created" | "updated" | "cancelled" | "skipped"> {
  const externalId = message.id.trim();
  if (!externalId) return "skipped";
  message = { ...message, id: externalId };
  // Do this before any order mutation.  A duplicate delivery must never
  // cancel or update an order twice, including across server instances.
  if (!await claimMessage(message)) return "skipped";
  try {
  const platformOrderNumber = orderNumber(message);
  if (!platformOrderNumber) return "skipped";
  const existing = await db.order.findUnique({ where: { platformOrderNumber } });
  if (message.action === "cancel") {
    if (!existing) return "skipped";
    const cancelled = await db.$transaction(async (tx) => {
      // Never let an asynchronous cancellation mail overwrite an order that
      // has already been confirmed as returned/completed by an operator.
      const cancelled = await tx.order.updateMany({ where: { id: existing.id, status: { notIn: ["CANCELLED", "COMPLETED"] } }, data: { status: "CANCELLED", rawSource: message.text } });
      if (!cancelled.count) return false;
      await invalidatePendingIwayBatches(tx, existing.id, "飞书同步：订单已取消");
      await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：订单已取消", actor: "系统定时任务", metadata: JSON.stringify({ source: "feishu", messageId: message.id, reason: "飞书同步取消", previousStatus: existing.status }) } });
      return true;
    });
    await linkClaimedMessage(message, existing.id);
    return cancelled ? "cancelled" : "skipped";
  }
  const pickup = dateTime(pick(message.text, "(?:Departure Time|Pickup Time)"));
  const passengerName = pick(message.text, "Passenger Name");
  const passengerPhone = pick(message.text, "(?:Passenger Phone Number|Phone)");
  const pickupAddress = pick(message.text, "Pickup address");
  const dropoffAddress = pick(message.text, "Dropoff address");
  const platformVehicleType = pick(message.text, "Vehicle Type");
  if (!pickup || !passengerName || !passengerPhone || !pickupAddress || !dropoffAddress || !platformVehicleType) {
    await linkClaimedMessage(message, existing?.id);
    return "skipped";
  }
  const cityDetection = detectDispatchCity(pickupAddress, dropoffAddress);
  const city = cityDetection.city;
  const adults = numberFrom(pick(message.text, "(?:Adults|Number of passengers)"));
  const children = numberFrom(pick(message.text, "Children"));
  const statedLuggage = pick(message.text, "(?:Luggage|Number of luggage|Baggage)");
  const data = { serviceDate: pickup.serviceDate, pickupDateTime: pickup.date, passengerName, passengerPhone, pickupAddress, dropoffAddress, platformVehicleType, flightNumber: pick(message.text, "Flight Number") || null, adults, children, luggage: statedLuggage ? numberFrom(statedLuggage) : adults + children, meetGreetLine: meetGreetFor(message.text), rawSource: message.text };
  if (existing) {
    const updated = await db.$transaction(async (tx) => {
      const fleet = city ? await canonicalFleetForCity(tx, city) : null;
      const current = await tx.order.findUnique({ where: { id: existing.id }, select: { status: true } });
      if (!current || decideFeishuUpdate(current.status, false) === "skip-completed") {
        if (current) await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：订单更新未覆盖", actor: "系统定时任务", metadata: `邮件：${message.id}；订单已完成` } });
        return false;
      }
      if (current.status === "CANCELLED") {
        const latestCancel = await tx.activityLog.findFirst({ where: { orderId: existing.id, action: { in: ["订单已取消", "飞书邮件同步：订单已取消"] } }, orderBy: { createdAt: "desc" } });
        const decision = decideFeishuUpdate(current.status, latestCancel?.action === "飞书邮件同步：订单已取消");
        if (decision === "skip-local-cancel") {
          await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：订单更新未覆盖", actor: "系统定时任务", metadata: `邮件：${message.id}；订单由运营人员取消，需人工核实` } });
          return false;
        }
        // A new non-cancellation message from the same external source is the
        // required external verification that the previously cancelled order
        // is active again. It is the only automatic recovery path.
        const previous = (() => { try { const value = JSON.parse(latestCancel?.metadata ?? "{}"); return typeof value.previousStatus === "string" ? value.previousStatus : "READY_TO_DISPATCH"; } catch { return "READY_TO_DISPATCH"; } })();
        const restored = await tx.order.updateMany({ where: { id: existing.id, status: "CANCELLED" }, data: { ...(city ? { ...data, city, fleetId: fleet!.id } : data), status: previous } });
        if (!restored.count) return false;
        await invalidatePendingIwayBatches(tx, existing.id, "飞书同步：订单已恢复，旧回传预览失效");
        await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：订单已恢复", actor: "系统定时任务", metadata: `邮件：${message.id}；城市判断：${cityDetection.reason}` } });
        return true;
      }
      const updated = await tx.order.updateMany({ where: { id: existing.id, status: { notIn: ["CANCELLED", "COMPLETED"] } }, data: city ? { ...data, city, fleetId: fleet!.id } : data });
      if (updated.count) {
        await tx.activityLog.create({ data: { orderId: existing.id, action: "飞书邮件同步：订单已更新", actor: "系统定时任务", metadata: `邮件：${message.id}；城市判断：${cityDetection.reason}` } });
        return true;
      }
      return false;
    });
    await linkClaimedMessage(message, existing.id);
    return updated ? "updated" : "skipped";
  }
  const fleet = city ? await canonicalFleetForCity(db, city) : null;
  const created = await db.order.create({ data: { platformOrderNumber, ...data, city: city ?? "待确认", fleetId: fleet?.id ?? null, status: city ? "READY_TO_DISPATCH" : "PENDING_REVIEW" } });
  await db.activityLog.create({ data: { orderId: created.id, action: "飞书邮件同步：新增订单", actor: "系统定时任务", metadata: `邮件：${message.id}；城市判断：${cityDetection.reason}` } });
  await linkClaimedMessage(message, created.id);
  return "created";
  } catch (error) {
    // A transport/database failure should be retryable.  Release only our
    // reservation; successfully handled messages keep their claim forever.
    await releaseClaim(message).catch(() => undefined);
    throw error;
  }
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
