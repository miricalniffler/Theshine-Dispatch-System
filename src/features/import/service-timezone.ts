export type ServiceTimeZoneDetection = {
  timeZone: string | null;
  reason: string;
};

type ZoneRule = { timeZone: string; signals: RegExp[] };

// Keep this separate from dispatch-city routing.  A location can be recognised
// well enough to know its civil time while still being outside the two cities
// currently supported by the fleet-routing configuration.
const zoneRules: ZoneRule[] = [
  { timeZone: "Asia/Bangkok", signals: [/\b(?:bangkok|bkk|pattaya|chon\s*buri|suvarnabhumi|don\s*mue?ang|dmk|koh\s*samui|samui|usm)\b/i, /ประเทศไทย|กรุงเทพ|สุวรรณภูมิ|สมุย/u] },
  { timeZone: "Asia/Tokyo", signals: [/\b(?:tokyo|japan|haneda|narita|hnd|nrt)\b/i, /東京|日本|羽田|成田/u] },
  { timeZone: "Asia/Kuala_Lumpur", signals: [/\b(?:kuala\s*lumpur|malaysia|klia|kul)\b/i, /كوالالمبور/u] },
  { timeZone: "Asia/Singapore", signals: [/\b(?:singapore|changi|sin)\b/i, /新加坡/u] },
];

function matches(value: string, rule: ZoneRule) {
  return rule.signals.some((signal) => signal.test(value));
}

/**
 * Identifies a service time zone only when both endpoints point to one clear
 * region.  Mixed or unknown routes deliberately remain unclassified rather
 * than silently becoming Bangkok time.
 */
export function detectServiceTimeZone(pickupAddress: string | null | undefined, dropoffAddress: string | null | undefined): ServiceTimeZoneDetection {
  const text = `${pickupAddress ?? ""}\n${dropoffAddress ?? ""}`;
  const zones = zoneRules.filter((rule) => matches(text, rule)).map((rule) => rule.timeZone);
  const uniqueZones = [...new Set(zones)];
  if (uniqueZones.length === 1) return { timeZone: uniqueZones[0], reason: `接送地点可确认使用 ${uniqueZones[0]}` };
  if (uniqueZones.length > 1) return { timeZone: null, reason: "接送地点出现不同地区标识，无法安全确定服务时区" };
  return { timeZone: null, reason: "接送地点未找到可靠地区标识，无法安全确定服务时区" };
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return Number(parts.find((item) => item.type === type)?.value || 0);
}

/** Converts an explicit local YYYY-MM-DDTHH:mm value into an instant. */
export function zonedLocalDateTimeToUtc(value: string, timeZone: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const expectedUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    // The first pass discovers the zone offset at the candidate instant. The
    // second pass handles zones that change their UTC offset around DST.
    let instant = expectedUtc;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const local = formatter.formatToParts(new Date(instant));
      const representedUtc = Date.UTC(part(local, "year"), part(local, "month") - 1, part(local, "day"), part(local, "hour"), part(local, "minute"));
      instant += expectedUtc - representedUtc;
    }
    const result = new Date(instant);
    return Number.isNaN(result.getTime()) ? null : result;
  } catch {
    return null;
  }
}
