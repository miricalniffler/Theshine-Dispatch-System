export type SupportedDispatchCity = "曼谷" | "苏梅";

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

  if (hasSamui && !hasBangkok) return { city: "苏梅", reason: "接人或送人地址包含苏梅地区或机场标识" };
  if (hasBangkok && !hasSamui) return { city: "曼谷", reason: "接人或送人地址包含曼谷／芭提雅服务区标识" };
  if (hasSamui && hasBangkok) return { city: null, reason: "接人和送人地址出现不同服务区标识，请人工确认" };
  return { city: null, reason: "接人和送人地址均未找到可靠的城市标识，请人工确认" };
}
