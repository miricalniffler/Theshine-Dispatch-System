import type { ImportedMessage } from "./connectors";

export type IwayMailEventType = "NEW_ORDER" | "CANCELLATION_CONFIRMED" | "MODIFICATION" | "REVIEW";

const trustedSenders = new Set(["control@iwayex.com", "noreply@iway.ru"]);
export function normalizedIwaySender(value?: string) { return (value?.match(/<([^>]+)>/)?.[1] || value || "").trim().toLowerCase(); }
export function isTrustedIwaySender(value?: string) { return trustedSenders.has(normalizedIwaySender(value)); }
export function iwayOrderNumber(message: Pick<ImportedMessage, "subject" | "text">) {
  const labelled = message.text.match(/(?:ride\s*(?:number|no\.?|id)|order\s*(?:number|no\.?|id))\s*[:#]?\s*([\d\s]{5,})/i)?.[1];
  const subject = message.subject?.match(/(?:ride|order|transfer)?\s*#?([\d\s]{5,})/i)?.[1];
  return (labelled || subject || "").replace(/\s/g, "");
}
export function classifyIwayMail(message: ImportedMessage): { type: IwayMailEventType; reason: string; orderNo: string } {
  const subject = message.subject || "";
  const text = message.text || "";
  const orderNo = iwayOrderNumber(message);
  if (!isTrustedIwaySender(message.sender)) return { type: "REVIEW", reason: "发件人不在已验证 iWay 白名单中", orderNo };
  if (/\b(?:cancel(?:lation|led)?\s+(?:request|policy|fee|charge)|cannot\s+cancel|cancel(?:lation)?\s+failed|not\s+cancelled|re-?confirm)/i.test(`${subject}\n${text}`)) return { type: "REVIEW", reason: "邮件包含请求、政策、费用、失败或重新确认语义", orderNo };
  if (orderNo && /\b(?:transfer|ride|order)\b.*\b(?:has been |is )?(?:cancelled|canceled|voided)\b|\b(?:cancelled|canceled|voided)\b.*\b(?:transfer|ride|order)\b/i.test(subject)) return { type: "CANCELLATION_CONFIRMED", reason: "可信发件人、明确取消主题和订单号均已匹配", orderNo };
  if (orderNo && /\b(?:amendment|modified|updated|change(?:d)?\s+to)\b/i.test(subject)) return { type: "MODIFICATION", reason: "可信修改邮件，需人工确认差异", orderNo };
  if (/\b(?:new\s+ride|transfer\s+service\s+order)\b/i.test(subject)) return { type: "NEW_ORDER", reason: "可信新订单通知", orderNo };
  return { type: "REVIEW", reason: "邮件类型无法可靠确认", orderNo };
}
