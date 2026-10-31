import { isQwenConfigured, qwenJson } from "./qwen";
import { recognizeVehicleImage } from "./vision";
import { resolveVehicleModel } from "@/lib/rules/engine";
import { AI_MODELS } from "./model-config";
import { db } from "@/lib/db";

export type ReviewAssistance = {
  status: "NOT_NEEDED" | "MANUAL_REVIEW_REQUIRED" | "SUGGESTION_READY";
  provider: string;
  message: string;
  value?: string;
  confidence?: number;
};

const thaiCharacters = /[\u0E00-\u0E7F]/;
export function isAiNameTransliterationEnabled() { return process.env.AI_NAME_TRANSLITERATION_ENABLED === "true"; }

// Text translation and name transliteration have no dependency on the image
// switch.  They share the explicit text-assistance opt-in to prevent surprise
// paid requests while allowing the two feature families to be enabled apart.
export function isAiThaiTextAssistanceEnabled() { return isAiNameTransliterationEnabled(); }

function usableEnglishName(value: string | null | undefined) {
  return Boolean(value?.trim() && /[A-Za-z]/.test(value) && !thaiCharacters.test(value));
}

/**
 * DriverDetail keeps the original fleet reply together with the operator's
 * confirmed name.  Reuse only that verified Latin-script value before asking
 * a provider to transliterate the same Thai name again.
 */
export async function findConfirmedEnglishDriverNames(names: string[]) {
  const requested = [...new Set(names.map((name) => name.trim()).filter((name) => thaiCharacters.test(name)))];
  if (!requested.length) return new Map<string, string>();
  const history = await db.driverDetail.findMany({
    where: { confirmedDriverName: { not: null }, rawReply: { not: null } },
    orderBy: { confirmedAt: "desc" },
    take: 1_000,
    select: { rawReply: true, confirmedDriverName: true },
  });
  const found = new Map<string, string>();
  for (const thai of requested) {
    const entry = history.find((item) => item.rawReply?.includes(thai) && usableEnglishName(item.confirmedDriverName));
    if (entry?.confirmedDriverName) found.set(thai, entry.confirmedDriverName.trim());
  }
  return found;
}

export async function transliterateThaiDriverNames(names: string[]) {
  const unique = [...new Set(names.map((name) => name.trim()).filter((name) => thaiCharacters.test(name)))];
  if (!unique.length) return { names: new Map<string, string>(), status: "NOT_NEEDED" as const, message: "未发现需要转写的泰文司机姓名。" };
  if (!isAiNameTransliterationEnabled()) return { names: new Map<string, string>(), status: "MANUAL_REVIEW_REQUIRED" as const, message: "姓名 AI 转写尚未开启；已保留泰文原名，请人工填写英文拼写。" };
  if (!isQwenConfigured()) return { names: new Map<string, string>(), status: "MANUAL_REVIEW_REQUIRED" as const, message: "姓名 AI 转写未配置 Qwen 服务；已保留泰文原名。" };
  try {
    const result = await qwenJson<{ names?: { thai?: unknown; english?: unknown }[] }>([{ role: "system", content: "你是泰国人名音译助手。将泰文司机姓名音译为常用英文拼写，不要翻译字面含义，不要编造。仅输出 JSON：{\"names\":[{\"thai\":\"原文\",\"english\":\"英文拼写\"}]}。" }, { role: "user", content: JSON.stringify(unique) }], AI_MODELS.thaiText.model, { timeoutMs: AI_MODELS.thaiText.timeoutMs });
    const translated = new Map<string, string>();
    for (const item of result.names ?? []) {
      if (typeof item.thai !== "string" || typeof item.english !== "string") continue;
      const thai = item.thai.trim();
      const english = item.english.trim().slice(0, 120);
      // Do not accept an unrelated translation, an echoed Thai value, or an
      // arbitrary non-name as an i'way-facing driver name.
      if (unique.includes(thai) && usableEnglishName(english)) translated.set(thai, english);
    }
    return { names: translated, status: "SUGGESTION_READY" as const, message: translated.size ? "已生成泰文姓名英文音译建议，请人工核对后保存。" : "AI 未能确定英文拼写；已保留泰文原名。" };
  } catch (error) { return { names: new Map<string, string>(), status: "MANUAL_REVIEW_REQUIRED" as const, message: `姓名音译暂不可用：${error instanceof Error ? error.message : "未知原因"}` }; }
}

export async function translateThaiForReview(text: string): Promise<ReviewAssistance> {
  if (!text.trim() || !thaiCharacters.test(text)) return { status: "NOT_NEEDED", provider: "本地检测", message: "原文中未发现泰文，无需翻译。" };
  if (!isAiThaiTextAssistanceEnabled()) return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "泰文文本 AI 协助尚未开启；请人工核对泰文原文。" };
  if (!isQwenConfigured()) return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "检测到泰文，但尚未配置 Qwen API。请人工核对原文；不会自动改写订单字段。" };
  try {
    const result = await qwenJson<{ translatedText?: unknown }>([
      { role: "system", content: "你是泰语翻译助手。将用户提供的泰语准确翻译成简体中文，保留姓名、电话号码、车牌和车型原样。必须输出 JSON：{\"translatedText\":\"...\"}。" },
      { role: "user", content: text },
    ], AI_MODELS.thaiText.model, { timeoutMs: AI_MODELS.thaiText.timeoutMs });
    const value = typeof result.translatedText === "string" ? result.translatedText : "";
    if (!value) throw new Error("服务未返回 translatedText");
    return { status: "SUGGESTION_READY", provider: "Qwen", message: "已生成翻译建议，请人工复核后再填写订单。", value };
  } catch (error) {
    return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: `翻译服务暂不可用（${error instanceof Error ? error.message : "未知原因"}）。请人工核对原文。` };
  }
}

export async function identifyVehicleFromImage(imageUrl: string): Promise<ReviewAssistance> {
  if (!imageUrl.trim()) return { status: "NOT_NEEDED", provider: "人工复核", message: "未提供车辆图片。" };
  try { new URL(imageUrl); } catch { return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "车辆图片地址无效，请检查后重试。" }; }
  const result = await recognizeVehicleImage(imageUrl);
  if (!result.vehicle_model) return { status: "MANUAL_REVIEW_REQUIRED", provider: result.provider === "NONE" ? "人工复核" : result.provider, message: result.note };
  const vehicle = resolveVehicleModel(result.vehicle_model, result.vehicle_brand);
  if (vehicle.needsManualReview) return { status: "MANUAL_REVIEW_REQUIRED", provider: result.provider, message: vehicle.reviewReason ?? result.note, value: vehicle.value ?? undefined };
  return { status: "SUGGESTION_READY", provider: result.provider, message: result.note, value: vehicle.value ?? undefined, confidence: result.confidence === "HIGH" ? 0.9 : result.confidence === "MEDIUM" ? 0.6 : result.confidence === "LOW" ? 0.3 : undefined };
}
