import { isQwenConfigured, qwenJson } from "./qwen";
import { isAiVisionRealCallsEnabled, recognizeVehicleImage } from "./vision";

export type ReviewAssistance = {
  status: "NOT_NEEDED" | "MANUAL_REVIEW_REQUIRED" | "SUGGESTION_READY";
  provider: string;
  message: string;
  value?: string;
  confidence?: number;
};

const thaiCharacters = /[\u0E00-\u0E7F]/;

export async function translateThaiForReview(text: string): Promise<ReviewAssistance> {
  if (!text.trim() || !thaiCharacters.test(text)) return { status: "NOT_NEEDED", provider: "本地检测", message: "原文中未发现泰文，无需翻译。" };
  if (!isAiVisionRealCallsEnabled()) return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "AI 实际调用尚未启用；请人工核对泰文原文。" };
  if (!isQwenConfigured()) return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "检测到泰文，但尚未配置 Qwen API。请人工核对原文；不会自动改写订单字段。" };
  try {
    const result = await qwenJson<{ translatedText?: unknown }>([
      { role: "system", content: "你是泰语翻译助手。将用户提供的泰语准确翻译成简体中文，保留姓名、电话号码、车牌和车型原样。必须输出 JSON：{\"translatedText\":\"...\"}。" },
      { role: "user", content: text },
    ], "qwen-flash");
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
  return { status: "SUGGESTION_READY", provider: result.provider, message: result.note, value: result.vehicle_model, confidence: result.confidence === "HIGH" ? 0.9 : result.confidence === "MEDIUM" ? 0.6 : result.confidence === "LOW" ? 0.3 : undefined };
}
