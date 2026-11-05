/** Pure, explicit order-field change planning for Gmail lifecycle events.
 * No database mutation happens here. A caller must verify sender, order identity,
 * source chronology, transaction lock, and persist a snapshot before applying.
 */
export const gmailMutableOrderFields = [
  "serviceDate", "pickupDateTime", "pickupAddress", "dropoffAddress",
  "passengerName", "passengerPhone", "flightNumber", "platformVehicleType",
  "adults", "children", "luggage", "meetGreetLine", "otherNotes",
] as const;

export type GmailMutableOrderField = typeof gmailMutableOrderFields[number];
export type OrderValue = string | number | Date | null;
export type GmailOrderSnapshot = Record<GmailMutableOrderField, OrderValue> & { status: string };
export type GmailFieldChange = { field: GmailMutableOrderField | "status"; before: string | number | null; after: string | number | null };

function stable(value: OrderValue): string | number | null {
  return value instanceof Date ? value.toISOString() : value;
}

/** Only explicitly supplied fields are candidates; absent fields never erase existing values. */
export function planGmailOrderChanges(
  current: GmailOrderSnapshot,
  explicit: Partial<Record<GmailMutableOrderField, OrderValue>>,
): GmailFieldChange[] {
  const allowed = new Set<string>(gmailMutableOrderFields);
  return Object.entries(explicit).flatMap(([field, proposed]) => {
    if (!allowed.has(field) || proposed === undefined) return [];
    const before = stable(current[field as GmailMutableOrderField]);
    const after = stable(proposed);
    return before === after ? [] : [{ field: field as GmailMutableOrderField, before, after }];
  });
}

/** Prevent rollback silently erasing any later manual or automated change. */
export function rollbackConflicts(
  current: GmailOrderSnapshot,
  expectedPostChange: GmailOrderSnapshot,
): Array<GmailMutableOrderField | "status"> {
  const fields: Array<GmailMutableOrderField | "status"> = [...gmailMutableOrderFields, "status"];
  return fields.filter(field =>
    stable(current[field]) !== stable(expectedPostChange[field]));
}

/** Use the destination city's IANA timezone for the visible sync-completed time. */
export function formatGmailSyncCompletedAt(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_SYNC_COMPLETED_AT");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(date).replace(",", "");
}
