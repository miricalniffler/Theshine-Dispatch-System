import * as webpush from "web-push";
import { db } from "@/lib/db";
import { isQwenConfigured, qwenJson } from "@/features/assist/qwen";

export type IncomingMail = { id: string; threadId?: string; sender: string; subject: string; receivedAt: string; text: string };
const KL = /kuala\s*lumpur|klia|bukit\s*bintang|petaling\s*jaya|malaysia|吉隆坡/i;
const COMPLAINT = /complaint|dissatisfied|unhappy|poor\s+service|refund|late|no\s+show|driver.*(?:rude|late)|投诉|迟到|没来/i;
const INQUIRY = /(?:inquir|quotation|quote|price|rate|booking\s+request|how\s+much|询价|报价)/i;
const ORDER_NO = /(?:order|ride|booking)\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\- ]{4,24})/i;

function classify(mail: IncomingMail) {
  const source = `${mail.subject}\n${mail.text}`;
  const city = KL.test(source) ? "吉隆坡" : null;
  return { city, category: city && COMPLAINT.test(source) ? "COMPLAINT" : city && INQUIRY.test(source) ? "INQUIRY" : "OTHER", orderNumber: source.match(ORDER_NO)?.[1]?.replace(/\s/g, "") ?? null };
}

function extraction(text: string) {
  const find = (pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? null;
  return {
    route: find(/(?:from|pickup)\s*[:：]?\s*([^\n]+?)(?:\s+(?:to|dropoff)\s*[:：]?\s*|\n)/i),
    date: find(/(?:date|service\s*date)\s*[:：]?\s*([^\n]+)/i),
    passengers: find(/(?:pax|passengers?|people)\s*[:：]?\s*(\d{1,3})/i),
    luggage: find(/(?:luggage|bags?)\s*[:：]?\s*(\d{1,3})/i),
    vehicleType: find(/(?:vehicle|car\s*type)\s*[:：]?\s*([^\n]+)/i),
  };
}

async function notify(message: { id: string; category: string; subject: string }) {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const contact = process.env.WEB_PUSH_CONTACT;
  if (!publicKey || !privateKey || !contact) return;
  webpush.setVapidDetails(contact, publicKey, privateKey);
  const subscriptions = await db.webPushSubscription.findMany();
  await Promise.all(subscriptions.map(async (item) => {
    try { await webpush.sendNotification({ endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } }, JSON.stringify({ title: message.category === "COMPLAINT" ? "吉隆坡投诉待处理" : "吉隆坡询价待处理", body: message.subject.slice(0, 120), url: `/mail-operations/${message.id}` })); }
    catch (error: any) { if (error?.statusCode === 404 || error?.statusCode === 410) await db.webPushSubscription.delete({ where: { id: item.id } }).catch(() => undefined); }
  }));
}

export async function ingestMailOperations(messages: IncomingMail[]) {
  let created = 0; let skipped = 0;
  for (const input of messages) {
    const receivedAt = new Date(input.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) continue;
    const result = classify(input);
    if (result.category === "OTHER") continue;
    const order = result.orderNumber ? await db.order.findUnique({ where: { platformOrderNumber: result.orderNumber } }) : null;
    const message = await db.mailOperationMessage.upsert({
      where: { gmailMessageId: input.id },
      create: { gmailMessageId: input.id, gmailThreadId: input.threadId ?? null, sender: input.sender, subject: input.subject, receivedAt, bodyText: input.text, category: result.category, city: result.city, orderId: order?.id, extracted: extraction(input.text), events: { create: { action: "GMAIL_DETECTED", actor: "Gmail 监控", details: { category: result.category } } } },
      update: {},
    });
    if (message.createdAt.getTime() === message.updatedAt.getTime()) { created++; await notify(message); } else skipped++;
  }
  return { created, skipped };
}

export async function messageContext(id: string) {
  return db.mailOperationMessage.findUnique({ where: { id }, include: { order: { include: { driverDetail: true, driverVehicleAssignments: { orderBy: { assignedAt: "desc" }, take: 10 }, activityLogs: { orderBy: { createdAt: "desc" }, take: 30 } } }, events: { orderBy: { createdAt: "desc" } } } });
}

export async function generateDraft(id: string, fleetFeedback?: string) {
  const message = await messageContext(id); if (!message) throw new Error("NOT_FOUND");
  const quote = message.category === "INQUIRY" ? await db.quoteRule.findFirst({ where: { city: "吉隆坡", isActive: true, routeKey: String((message.extracted as any)?.route ?? "").trim() } }) : null;
  if (message.category === "INQUIRY" && !quote) return { status: "NEEDS_PRICING", message: "未找到已维护的可靠报价规则，系统不会编造价格。" };
  const context = { category: message.category, subject: message.subject, email: message.bodyText, extracted: message.extracted, order: message.order ? { number: message.order.platformOrderNumber, route: `${message.order.pickupAddress} → ${message.order.dropoffAddress}`, driver: message.order.driverDetail, history: message.order.activityLogs.map(x => x.action) } : null, fleetFeedback: fleetFeedback || null, quote: quote ? { currency: quote.currency, baseCost: quote.baseCost?.toString(), marginRate: quote.marginRate?.toString(), surcharge: quote.surcharge?.toString() } : null };
  let draft = "";
  if (isQwenConfigured()) {
    const response = await qwenJson<{ draft?: string; summary?: string; questions?: string[] }>([
      { role: "system", content: "You are an operations email assistant. Write a concise, polite English reply draft only from supplied facts. Never invent prices, promises, names, times, or causes. For complaints acknowledge the concern and state pending verification where facts are incomplete. Return JSON: {draft,summary,questions}." },
      { role: "user", content: JSON.stringify(context) },
    ], "qwen3.7-plus", { timeoutMs: 30_000 });
    draft = response.draft?.trim() ?? "";
  }
  if (!draft) draft = message.category === "COMPLAINT" ? "Dear Customer,\n\nThank you for informing us. We are sorry to hear about your experience. We are reviewing the trip details with our operations team and will update you once the facts have been verified.\n\nKind regards,\nThe Shine Dispatch Team" : "A reliable price rule is available for this request. Please review the extracted trip details and complete the quote before sending.";
  await db.mailOperationMessage.update({ where: { id }, data: { draftReply: draft, draftUpdatedAt: new Date(), status: "DRAFT_READY", analysis: { context, generatedAt: new Date().toISOString() } } });
  await db.mailOperationEvent.create({ data: { messageId: id, action: "DRAFT_GENERATED", actor: "AI 邮件运营助手", details: { fleetFeedback: Boolean(fleetFeedback), pricingRuleFound: Boolean(quote) } } });
  return { status: "DRAFT_READY", draft };
}
