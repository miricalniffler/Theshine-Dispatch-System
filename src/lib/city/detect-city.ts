export type SupportedDispatchCity = "曼谷" | "苏梅" | "吉隆坡";

export type CityDetection = {
  city: SupportedDispatchCity | null;
  reason: string;
};

// These are operational areas, rather than a complete geographical gazetteer.
// The Bangkok team also covers the Pattaya/Chonburi routes used by this workflow.
const samuiSignals = [
  /\bkoh\s*samui\b/i,
  /\bsamui\b/i,
  /\busm\b/i,
  /สุราษฎร์ธานี/u,
  /\bchaweng\b/i,
  /\blamai\b/i,
  /\bbo\s*phut\b/i,
  /\bbophut\b/i,
  /\bmae\s*nam\b/i,
  /\bmaenam\b/i,
  /\bnathon\b/i,
  /\bchoeng\s*mon\b/i,
  /\bplai\s*laem\b/i,
  /\btaling\s*ngam\b/i,
  /\blipa\s*noi\b/i,
  /\blipanoi\b/i,
  /\bmaret\b/i,
  /\bbangrak\b/i,
  /\bbig\s*buddha\b/i,
  /\bfisherman'?s\s*village\b/i,
];

const bangkokSignals = [
  /\bbangkok\b/i,
  /\bbkk\b/i,
  /\bsuvarnabhumi\b/i,
  /\bdon\s*mue?ang\b/i,
  /\bdmk\b/i,
  /\bsukhumvit\b/i,
  /\bpattaya\b/i,
  /\bchon\s*buri\b/i,
];

// KUL/KLIA alone may describe a connection airport, so it is never enough to
// route an order.  A Kuala Lumpur metro/country signal must also be present.
const kualaLumpurMetroSignals = [/\bkuala\s*lumpur\b/i, /\bmalaysia\b/i, /\bpetaling\s*jaya\b/i, /\bsubang\s*jaya\b/i, /\bshah\s*alam\b/i, /\bputrajaya\b/i, /\bcyberjaya\b/i, /\bklang\b/i, /\bport\s*klang\b/i, /\bsepang\b/i, /吉隆坡|马来西亚/u];
const kualaLumpurAirportSignals = [/\bklia(?:2)?\b/i, /\bkul\b/i];

function hasSignal(value: string, signals: RegExp[]) {
  return signals.some((signal) => signal.test(value));
}

/**
 * Classifies a local transfer from both itinerary endpoints.  One clear Samui
 * signal is enough to classify it as Samui.  When the two endpoints point to
 * different operating areas, or neither has a reliable signal, it returns
 * null so callers can request review instead of silently defaulting to Bangkok.
 */
export function detectDispatchCity(pickupAddress: string | null | undefined, dropoffAddress: string | null | undefined): CityDetection {
  const endpoints = [pickupAddress ?? "", dropoffAddress ?? ""];
  const hasSamui = endpoints.some((address) => hasSignal(address, samuiSignals));
  const hasBangkok = endpoints.some((address) => hasSignal(address, bangkokSignals));
  const hasKualaMetro = endpoints.some((address) => hasSignal(address, kualaLumpurMetroSignals));
  const hasKualaAirport = endpoints.some((address) => hasSignal(address, kualaLumpurAirportSignals));
  const hasKualaLumpur = hasKualaMetro && (!hasKualaAirport || hasKualaMetro);
  const matched = [hasSamui, hasBangkok, hasKualaLumpur].filter(Boolean).length;

  if (hasSamui && matched === 1) return { city: "苏梅", reason: "接人或送人地址包含苏梅地区或机场标识" };
  if (hasBangkok && matched === 1) return { city: "曼谷", reason: "接人或送人地址包含曼谷／芭提雅服务区标识" };
  if (hasKualaLumpur && matched === 1) return { city: "吉隆坡", reason: "接送地点包含吉隆坡都会区或马来西亚服务区标识" };
  if (matched > 1) return { city: null, reason: "接人和送人地址出现不同服务区标识，请人工确认" };
  if (hasKualaAirport) return { city: null, reason: "仅出现 KUL/KLIA 机场代码，未能确认实际服务地区，请人工确认" };
  return { city: null, reason: "接人和送人地址均未找到可靠的城市标识，请人工确认" };
}

export function serviceTimeZoneForCity(city: string) { return city === "吉隆坡" ? "Asia/Kuala_Lumpur" : city === "曼谷" || city === "苏梅" ? "Asia/Bangkok" : null; }
