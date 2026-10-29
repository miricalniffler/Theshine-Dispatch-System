import { db } from "@/lib/db";
import { canonicalFleetForCity } from "@/features/fleets/canonical-fleets";
import { isIwayNewRideEmail, parseIwayNewRide } from "./iway-new-ride-parser";
import { zonedLocalDateTimeToUtc } from "./service-timezone";

export type GmailIwayMessage = { id: string; sender: string; subject: string; receivedAt: string; text: string };
export type GmailIwaySummary = { created: number; skipped: number; rejected: number; processedIds: string[] };

const connector = "gmail-iway";
const defaultSenders = ["control@iwayex.com", "noreply@iway.ru"];

function senderAddress(value: string) {
  return (value.match(/<([^>]+)>/)?.[1] || value).trim().toLowerCase();
}

function trustedSenders() {
  const configured = process.env.IWAY_GMAIL_ALLOWED_SENDERS?.split(/[;,]/).map(senderAddress).filter(Boolean);
  return configured?.length ? configured : defaultSenders;
}

export function isTrustedGmailNewOrder(message: GmailIwayMessage) {
  const subject = message.subject.trim();
  return trustedSenders().includes(senderAddress(message.sender))
    && /^(?:transfer\s+service\s+order|new\s+ride\s*#)/i.test(subject)
    && !/\b(?:cancel(?:led|lation)?|void|amendment|modified?|change(?:d)?)\b/i.test(subject)
    && isIwayNewRideEmail(message.text);
}

function validReceivedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function missingRequiredFields(parsed: ReturnType<typeof parseIwayNewRide>) {
  const required: Array<keyof ReturnType<typeof parseIwayNewRide>> = [
    "platformOrderNumber", "city", "serviceTimeZone", "pickupDateTime", "passengerName", "passengerPhone", "pickupAddress", "dropoffAddress", "platformVehicleType",
  ];
  return required.filter((key) => !parsed[key]);
}

function rejectedAction(parsed: ReturnType<typeof parseIwayNewRide>) {
  if (!parsed.city) return "NEW_ORDER_REJECTED_CITY_UNCONFIRMED";
  if (!parsed.serviceTimeZone) return "NEW_ORDER_REJECTED_TIME_ZONE_UNCONFIRMED";
  if (!parsed.pickupDateTime) return "NEW_ORDER_REJECTED_TIME_UNCONFIRMED";
  return "NEW_ORDER_REJECTED_MISSING_REQUIRED_FIELDS";
}

export type GmailIwayClassification =
  | { accepted: true; receivedAt: Date; parsed: ReturnType<typeof parseIwayNewRide> }
  | { accepted: false; reason: string; receivedAt?: Date; parsed?: ReturnType<typeof parseIwayNewRide> };

/** Pure eligibility check used by the route and regression tests. */
export function classifyGmailIwayMessage(message: GmailIwayMessage, enabledAt = process.env.IWAY_GMAIL_ENABLED_AT?.trim()) : GmailIwayClassification {
  const receivedAt = validReceivedAt(message.receivedAt);
  if (!receivedAt) return { accepted: false, reason: "INVALID_RECEIVED_AT" };
  if (!isTrustedGmailNewOrder(message)) return { accepted: false, reason: "UNTRUSTED_OR_NOT_NEW_ORDER", receivedAt };
  const waterline = enabledAt ? new Date(enabledAt) : null;
  if (!waterline || Number.isNaN(waterline.getTime()) || receivedAt.getTime() <= waterline.getTime()) return { accepted: false, reason: "BEFORE_ENABLE_WATERLINE", receivedAt };
  const parsed = parseIwayNewRide(message.text, { referenceDate: receivedAt });
  if (missingRequiredFields(parsed).length) return { accepted: false, reason: rejectedAction(parsed), receivedAt, parsed };
  return { accepted: true, receivedAt, parsed };
}

/**
 * Safely imports only verified iWay New ride messages. Cancellation and
 * amendment-shaped emails are intentionally outside this path.
 */
export async function ingestGmailIwayMessages(messages: GmailIwayMessage[]): Promise<GmailIwaySummary> {
  const run = await db.importSyncRun.create({ data: { connector, status: "RUNNING" } });
  const summary: GmailIwaySummary = { created: 0, skipped: 0, rejected: 0, processedIds: [] };
  try {
    for (const message of messages) {
      const classification = classifyGmailIwayMessage(message);
      if (!classification.accepted) {
        // A trusted, structured mail with missing/ambiguous order fields is a
        // permanent safe rejection. Record the reason once so Apps Script can
        // advance without retrying the same malformed mail every minute.
        if (classification.parsed && classification.receivedAt) {
          const known = await db.importedSourceMessage.findUnique({ where: { connector_externalId: { connector, externalId: message.id } } });
          if (!known) await db.importedSourceMessage.create({ data: {
            connector,
            externalId: message.id,
            action: classification.reason,
            sourceText: message.text,
            receivedAt: classification.receivedAt,
          } });
          summary.processedIds.push(message.id);
        }
        summary.rejected += 1;
        continue;
      }
      const { receivedAt, parsed } = classification;
      const result: "created" | "skipped" | "rejected" = await db.$transaction(async (tx) => {
        const known = await tx.importedSourceMessage.findUnique({ where: { connector_externalId: { connector, externalId: message.id } } });
        if (known) return "skipped" as const;
        // Store a protected audit record for a structurally valid iWay mail
        // even when it cannot safely create an order.  This prevents an Apps
        // Script retry storm while retaining a traceable reason; no mail body
        // ever reaches application logs or an API response.
        const existing = await tx.order.findUnique({ where: { platformOrderNumber: parsed.platformOrderNumber } });
        const sourceMessage = await tx.importedSourceMessage.create({ data: { connector, externalId: message.id, action: existing ? "NEW_ORDER_SKIPPED_EXISTING" : "NEW_ORDER_IMPORTED", sourceText: message.text, orderId: existing?.id, receivedAt } });
        if (existing) return "skipped" as const;
        const fleet = await canonicalFleetForCity(tx, parsed.city);
        const pickupDateTime = zonedLocalDateTimeToUtc(parsed.pickupDateTime, parsed.serviceTimeZone);
        if (!pickupDateTime) throw new Error("GMAIL_ORDER_TIME_ZONE_CONVERSION_FAILED");
        const created = await tx.order.create({ data: {
          platformOrderNumber: parsed.platformOrderNumber,
          city: parsed.city,
          fleetId: fleet.id,
          serviceDate: parsed.pickupDateTime.slice(0, 10),
          pickupDateTime,
          pickupAddress: parsed.pickupAddress,
          dropoffAddress: parsed.dropoffAddress,
          passengerName: parsed.passengerName,
          passengerPhone: parsed.passengerPhone,
          flightNumber: parsed.flightNumber || null,
          platformVehicleType: parsed.platformVehicleType,
          adults: parsed.adults,
          children: parsed.children,
          luggage: parsed.luggage,
          meetGreetLine: parsed.meetGreetLine || null,
          otherNotes: parsed.otherNotes || null,
          rawSource: message.text,
          status: "READY_TO_DISPATCH",
        } });
        await tx.importedSourceMessage.update({ where: { id: sourceMessage.id }, data: { orderId: created.id } });
        await tx.activityLog.create({ data: { orderId: created.id, action: "从 Gmail 邮箱导入未来订单", actor: "Gmail 同步", metadata: JSON.stringify({ messageId: message.id, subject: message.subject, receivedAt: receivedAt.toISOString() }) } });
        return "created" as const;
      });
      summary[result] += 1;
      summary.processedIds.push(message.id);
    }
    await db.importSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", completedAt: new Date(), createdCount: summary.created, skippedCount: summary.skipped + summary.rejected } });
    return summary;
  } catch (error) {
    // Do not store raw email content in an error message. The raw source is
    // retained only on the idempotent message record for a successfully
    // imported/known message.
    await db.importSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), errorMessage: error instanceof Error ? error.message.slice(0, 300) : "Gmail 导入失败" } });
    throw error;
  }
}

export async function getGmailIwaySyncStatus() {
  return db.importSyncRun.findFirst({ where: { connector }, orderBy: { startedAt: "desc" } });
}

export function gmailIwaySyncReady() {
  const target = process.env.IWAY_GMAIL_TARGET_ENVIRONMENT?.trim();
  return Boolean(
    process.env.IWAY_GMAIL_INGEST_TOKEN?.trim()
    && process.env.IWAY_GMAIL_ENABLED_AT?.trim()
    && (target === "preview" || target === "production"),
  );
}
