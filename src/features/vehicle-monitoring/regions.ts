/** Explicit geography is intentionally kept separate from display labels. */
export const COUNTRY_SCOPES = {
  GLOBAL: [] as string[],
  TH: ["TH"],
  KH: ["KH"],
  VN: ["VN"],
  LK: ["LK"],
  NP: ["NP"],
  KR: ["KR"],
  TH_KH_VN_LK_NP: ["TH", "KH", "VN", "LK", "NP"],
  EUROPE: ["AL", "AD", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "SE", "SI", "SK", "SM", "UA", "VA"],
} as const;

export type CountryScopeKey = keyof typeof COUNTRY_SCOPES;

const countryNames: Record<string, string> = {
  "泰国": "TH", Thailand: "TH", TH: "TH", "柬埔寨": "KH", Cambodia: "KH", KH: "KH", "越南": "VN", Vietnam: "VN", VN: "VN",
  "斯里兰卡": "LK", "Sri Lanka": "LK", LK: "LK", "尼泊尔": "NP", Nepal: "NP", NP: "NP", "韩国": "KR", Korea: "KR", KR: "KR",
};

export function countryCode(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return countryNames[trimmed] ?? (trimmed.length === 2 ? trimmed.toUpperCase() : null);
}

export function scopeMatches(scope: string, code: string | null | undefined) {
  if (scope === "GLOBAL") return true;
  const countries = COUNTRY_SCOPES[scope as CountryScopeKey];
  return Boolean(code && countries?.includes(code as never));
}

export function scopeSpecificity(scope: string) { return scope === "GLOBAL" ? 0 : 1; }
