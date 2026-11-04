import { createHmac, randomUUID } from "node:crypto";

export type GmailManualTriggerResult =
  | { kind: "completed"; created: number; cancelled: number; review: number; skipped: number; rejected: number }
  | { kind: "in-progress"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "failed"; code?: string; message: string };

const triggerTimeoutMs = 55_000;

function triggerConfig() {
  return { url: process.env.IWAY_GMAIL_MANUAL_TRIGGER_URL?.trim() || "", secret: process.env.IWAY_GMAIL_MANUAL_TRIGGER_SECRET?.trim() || "" };
}

function safeTriggerUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "script.google.com" || url.hostname === "script.googleusercontent.com");
  } catch { return false; }
}

/** This only means Vercel has server-side configuration; Apps Script confirms availability on each request. */
export function gmailManualTriggerReady() {
  const { url, secret } = triggerConfig();
  return Boolean(secret) && safeTriggerUrl(url);
}

function signedPayload(action: "sync" | "status", secret: string) {
  const issuedAt = new Date().toISOString();
  const nonce = randomUUID();
  const signature = createHmac("sha256", secret).update(`${action}\n${issuedAt}\n${nonce}`).digest("base64");
  return { action, issuedAt, nonce, signature };
}

function numberField(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0; }

function userSafeFailure(code: unknown) {
  if (code === "GMAIL_QUOTA_EXHAUSTED") return "Gmail 配额不足，同步失败。";
  if (code === "MANUAL_TRIGGER_NOT_CONFIGURED") return "Gmail 手动同步尚未完成 Apps Script 配置。";
  return "Gmail 同步失败，请检查受保护的 Apps Script 执行记录后重试。";
}

export async function triggerManualGmailSync(fetchImpl: typeof fetch = fetch): Promise<GmailManualTriggerResult> {
  if (!gmailManualTriggerReady()) return { kind: "unavailable", message: "Gmail 手动同步尚未配置；请先部署并配置 Google Apps Script。" };
  const { url, secret } = triggerConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), triggerTimeoutMs);
  try {
    const response = await fetchImpl(url, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(signedPayload("sync", secret)), signal: controller.signal });
    const payload = await response.json().catch(() => null) as { status?: string; code?: string; summary?: Record<string, unknown> } | null;
    if (!response.ok || !payload) return { kind: "failed", message: "Gmail 同步触发服务不可用；尚未确认同步成功。" };
    if (payload.status === "IN_PROGRESS") return { kind: "in-progress", message: "已有一轮 Gmail 同步正在进行，请等待其完成。" };
    if (payload.status !== "SUCCEEDED") return { kind: "failed", code: payload.code, message: userSafeFailure(payload.code) };
    const summary = payload.summary || {};
    return { kind: "completed", created: numberField(summary.created), cancelled: numberField(summary.cancelled), review: numberField(summary.review), skipped: numberField(summary.skipped), rejected: numberField(summary.rejected) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { kind: "failed", message: "Gmail 同步请求超时，尚未确认同步成功；请查看最新同步状态后再试。" };
    return { kind: "failed", message: "Gmail 同步触发服务不可用；尚未确认同步成功。" };
  } finally { clearTimeout(timer); }
}

/** A signed, no-Gmail-read probe. It prevents the dashboard from enabling the button merely because Vercel variables exist. */
export async function gmailManualTriggerAvailable(fetchImpl: typeof fetch = fetch) {
  if (!gmailManualTriggerReady()) return false;
  const { url, secret } = triggerConfig();
  const request = signedPayload("status", secret);
  const target = new URL(url);
  Object.entries(request).forEach(([key, value]) => target.searchParams.set(key, value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(target, { method: "GET", cache: "no-store", signal: controller.signal });
    const payload = await response.json().catch(() => null) as { status?: string } | null;
    return Boolean(response.ok && payload?.status === "READY");
  } catch { return false; }
  finally { clearTimeout(timer); }
}
