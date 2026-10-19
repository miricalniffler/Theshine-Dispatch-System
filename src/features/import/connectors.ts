export type ImportConnectorId = "feishu-mail" | "esforty";

export type ConnectorStatus = {
  id: ImportConnectorId;
  label: string;
  configured: boolean;
  message: string;
};

export type ImportedMessage = {
  id: string;
  text: string;
  subject?: string;
  receivedAt?: string;
  sender?: string;
  action: "upsert" | "cancel";
};

type ConnectorConfig = {
  id: ImportConnectorId;
  label: string;
  url?: string;
  token?: string;
  enabled: boolean;
  setupHint: string;
};

function truthy(value: string | undefined) {
  return value?.trim().toLowerCase() === "true" || value?.trim() === "1";
}

function connectorConfig(id: ImportConnectorId): ConnectorConfig {
  if (id === "feishu-mail") {
    return {
      id,
      label: "飞书邮件",
      url: process.env.FEISHU_MAIL_IMPORT_URL?.trim(),
      token: process.env.FEISHU_MAIL_IMPORT_TOKEN?.trim(),
      enabled: truthy(process.env.FEISHU_MAIL_IMPORT_ENABLED),
      setupHint: "在服务器环境中填写 FEISHU_MAIL_IMPORT_ENABLED、FEISHU_MAIL_IMPORT_URL 和 FEISHU_MAIL_IMPORT_TOKEN。",
    };
  }
  return {
    id,
    label: "esforty",
    url: process.env.ESFORTY_IMPORT_URL?.trim(),
    token: process.env.ESFORTY_IMPORT_TOKEN?.trim(),
    enabled: truthy(process.env.ESFORTY_IMPORT_ENABLED),
    setupHint: "在 .env 中填写 ESFORTY_IMPORT_ENABLED、ESFORTY_IMPORT_URL 和 ESFORTY_IMPORT_TOKEN。",
  };
}

const defaultFeishuSenders = ["control@iwayex.com", "noreply@iway.ru"];

function senderAddress(value: string | undefined) {
  const match = value?.match(/<([^>]+)>/);
  return (match?.[1] || value || "").trim().toLowerCase();
}

function allowedFeishuSenders() {
  const configured = process.env.FEISHU_MAIL_ALLOWED_SENDER?.split(/[;,]/).map(senderAddress).filter(Boolean);
  return configured?.length ? configured : defaultFeishuSenders;
}

function isRecognizedFeishuSubject(subject: string | undefined) {
  const value = subject?.trim() || "";
  return /^(?:new\s+ride|transfer\s+service\s+order|amendment\s+to\s+(?:the\s+)?transfer)\b/i.test(value)
    || /cancel|取消|void/i.test(value);
}

/**
 * The Feishu mailbox receives iWay mail from two official senders. Keep this
 * predicate alongside the connector so browser, cron, and manual sync follow
 * the same safe allow-list rather than accepting arbitrary mailbox content.
 */
export function filterFeishuMailItems(items: ImportedMessage[], allowedSenders = allowedFeishuSenders()) {
  return items.filter((item) => allowedSenders.includes(senderAddress(item.sender))
    && (isRecognizedFeishuSubject(item.subject) || /cancel|取消|void/i.test(item.text)));
}

function isSafeRemoteUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
  } catch {
    return false;
  }
}

function statusFor(config: ConnectorConfig): ConnectorStatus {
  if (!config.enabled) return { id: config.id, label: config.label, configured: false, message: `尚未启用。${config.setupHint}` };
  if (!isSafeRemoteUrl(config.url) || !config.token) return { id: config.id, label: config.label, configured: false, message: `配置不完整或地址无效。${config.setupHint}` };
  return { id: config.id, label: config.label, configured: true, message: "已配置，导入时将从已授权的接入地址读取邮件/订单原文。" };
}

export function listConnectorStatus(): ConnectorStatus[] {
  return [statusFor(connectorConfig("feishu-mail")), statusFor(connectorConfig("esforty"))];
}

function normalizeAction(row: Record<string, unknown>, subject: string | undefined, text: string) {
  const raw = [row.action, row.type, row.event, row.status, subject].find((field): field is string => typeof field === "string")?.toLowerCase() ?? "";
  return /cancel|取消|void/.test(raw) || /cancelled|取消/.test(text) ? "cancel" : "upsert";
}

function normalizeItems(payload: unknown): ImportedMessage[] {
  const value = payload as { items?: unknown; data?: unknown };
  const candidates = Array.isArray(payload) ? payload : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : [];
  return candidates.flatMap((item, index) => {
    if (typeof item === "string" && item.trim()) return [{ id: `remote-${index}`, text: item, action: /cancelled|取消/i.test(item) ? "cancel" : "upsert" }];
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const text = [row.text, row.body, row.rawText, row.content].find((field): field is string => typeof field === "string" && field.trim().length > 0);
    if (!text) return [];
    const sender = [row.sender, row.from, row.fromAddress, row.email].find((field): field is string => typeof field === "string" && field.trim().length > 0);
    const subject = typeof row.subject === "string" ? row.subject : undefined;
    return [{ id: typeof row.id === "string" ? row.id : `remote-${index}`, text, subject, receivedAt: typeof row.receivedAt === "string" ? row.receivedAt : undefined, sender, action: normalizeAction(row, subject, text) }];
  });
}

/**
 * Connectors intentionally use an operator-provided import bridge rather than
 * browser automation. Each bridge returns an array (or {items: []}) containing
 * raw order text. This keeps provider credentials out of the browser and lets
 * the existing manual review flow remain the final gate before an order is saved.
 */
export async function pullConnectorMessages(id: ImportConnectorId, options: { allowEmpty?: boolean } = {}): Promise<{ connector: ConnectorStatus; items: ImportedMessage[] }> {
  const config = connectorConfig(id);
  const connector = statusFor(config);
  if (!connector.configured || !config.url || !config.token) {
    const error = new Error(connector.message);
    error.name = "CONNECTOR_NOT_CONFIGURED";
    throw error;
  }
  try {
    const response = await fetch(config.url, { headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok) throw new Error(`接入地址返回 HTTP ${response.status}`);
    let items = normalizeItems(await response.json());
    if (id === "feishu-mail") {
      const allowedSenders = allowedFeishuSenders();
      items = filterFeishuMailItems(items);
      if (!items.length && !options.allowEmpty) throw new Error(`没有来自 ${allowedSenders.join("、")} 的 iWay 新订单、变更或取消邮件，已阻止导入其他邮件。`);
    }
    if (!items.length && !options.allowEmpty) throw new Error("接入地址未返回可识别的订单原文。");
    return { connector, items };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知连接错误";
    const wrapped = new Error(`${config.label} 导入失败：${message}`);
    wrapped.name = "CONNECTOR_PULL_FAILED";
    throw wrapped;
  }
}
