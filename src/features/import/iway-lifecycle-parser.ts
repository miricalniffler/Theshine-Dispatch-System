/** Rules verified against actual iWay Gmail notices (2026-11-01).
 * No keyword in a footer, quote or policy is sufficient to cancel a ride.
 */
export type LifecycleNotice = { kind: "cancel" | "amend" | "review"; orderNumber: string | null; reason: string };
const digits = (value: string) => value.replace(/[\s\u00a0\u202f]/g, "");
export function classifyLifecycleNotice(subject: string, text: string): LifecycleNotice | null {
  const s = subject.trim();
  text = text.replace(/\r\n?/g, "\n");
  const match = s.match(/^(CANCELLATION of|AMENDMENT to) the transfer #([\d\s\u00a0\u202f]+)\s*\(i[’']way\)$/i);
  const bodyIds = [...text.matchAll(/\bRide number\s*[:：]\s*([\d \t\u00a0\u202f]+)(?=\r?\n|$)/gi)].map(m => digits(m[1]));
  const subjectId = match ? digits(match[2]) : null;
  const unique = [...new Set(bodyIds)];
  const orderNumber = subjectId && /^\d{5,12}$/.test(subjectId) && unique.length === 1 && unique[0] === subjectId ? subjectId : null;
  if (!match) {
    if (/^(?:CANCELLATION|AMENDMENT)\b/i.test(s)) return { kind: "review", orderNumber: null, reason: "UNVERIFIED_SUBJECT" };
    return null;
  }
  if (!orderNumber) return { kind: "review", orderNumber: null, reason: "ORDER_NUMBER_MISSING_OR_CONFLICTING" };
  if (/^CANCELLATION/i.test(s)) {
    const explicit = /(?:^|\n)\s*Cancellation of transfer service order\s*[.\r\n]/i.test(text)
      && /Dear partners,\s*please cancel the following transfer\./i.test(text)
      && /ATTENTION:\s*all the other orders stay valid\./i.test(text);
    return { kind: explicit ? "cancel" : "review", orderNumber, reason: explicit ? "EXPLICIT_CANCELLATION" : "CANCELLATION_BODY_UNCONFIRMED" };
  }
  return { kind: /Dear partners,\s*we send you an amendment of the following transfer/i.test(text) ? "amend" : "review", orderNumber, reason: "AMENDMENT_REQUIRES_REVIEW" };
}

export type MailField = { label: string; current: string; previous: string[] };
export function lifecycleFields(fields: MailField[] | undefined) {
  // Client supplied HTML is never rendered; only bounded text cells are used.
  return (fields ?? []).map(f => ({ label: f.label.trim().replace(/[:：]$/, ""), current: f.current.trim(), previous: f.previous }));
}
export function currentLifecycleText(text: string, fields: MailField[] | undefined) {
  if (!fields?.length) return text;
  return lifecycleFields(fields).map(f => `${f.label}:\n${f.current}`).join("\n");
}
