// The mailbox reader runs as a standalone Node process on the operations Mac,
// rather than inside the Next.js runtime. Keep its routing rules deliberately
// conservative and aligned with src/lib/city/detect-city.ts: an airport code
// by itself is not enough to assign a dispatch city.
const kualaLumpurSignals = /\b(?:kuala\s*lumpur|malaysia|petaling\s*jaya|subang\s*jaya|shah\s*alam|putrajaya|cyberjaya|port\s*klang|sepang)\b|吉隆坡|马来西亚/ui;
const kualaLumpurAirportSignal = /\b(?:klia2?|kul)\b/i;

export function cityFromIwayOrder(iwayCity, pickupAddress, dropoffAddress) {
  const route = `${pickupAddress || ""}\n${dropoffAddress || ""}`;
  const city = String(iwayCity || "").trim();

  const hasSamui = /\b(?:koh\s+samui|ko\s+samui|samui|chaweng|lamai|bophut|bo\s+phut|surat\s+thani|usm)\b/i.test(route);
  const hasBangkok = /\b(?:bangkok|bkk|suvarnabhumi|don\s*mue?ang|dmk|pattaya|chon\s*buri)\b/i.test(route);
  const hasKualaLumpur = kualaLumpurSignals.test(route);
  const hasLombok = /\b(?:lombok|lop|mataram|telok\s*kodek|gili)\b|龙目岛/ui.test(route);
  const matched = [hasSamui, hasBangkok, hasKualaLumpur, hasLombok].filter(Boolean).length;

  // Match the application router: conflicting itinerary evidence must be
  // reviewed, not forced to whichever condition happens to run first.
  if (matched > 1) return null;
  if (hasSamui) return "苏梅";
  if (hasBangkok) return "曼谷";
  if (hasKualaLumpur) return "吉隆坡";
  if (hasLombok) return "龙目岛";

  if (/^(?:koh\s+samui|ko\s+samui|samui)$/i.test(city)) return "苏梅";
  if (/^bangkok$/i.test(city)) return "曼谷";
  // A declared i'way city is sufficient evidence when the individual address
  // lines omit a city. Do not turn KUL/KLIA alone into a Kuala Lumpur order.
  if (/^(?:kuala\s*lumpur|kl|吉隆坡)$/i.test(city)) return "吉隆坡";
  if (/^(?:lombok|龙目岛)$/i.test(city)) return "龙目岛";
  if (kualaLumpurAirportSignal.test(route)) return null;
  return null;
}

export function serviceTimeZoneForLocalSync(city) { return city === "吉隆坡" ? "Asia/Kuala_Lumpur" : city === "龙目岛" ? "Asia/Makassar" : "Asia/Bangkok"; }
