export type ReviewAssistance = {
  status: "NOT_NEEDED" | "MANUAL_REVIEW_REQUIRED" | "SUGGESTION_READY";
  provider: string;
  message: string;
  value?: string;
  confidence?: number;
};

const thaiCharacters = /[\u0E00-\u0E7F]/;

async function requestProvider(url: string, apiKey: string, payload: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`服务返回 ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function translateThaiForReview(text: string): Promise<ReviewAssistance> {
  if (!text.trim() || !thaiCharacters.test(text)) return { status: "NOT_NEEDED", provider: "本地检测", message: "原文中未发现泰文，无需翻译。" };
  const url = process.env.TRANSLATION_PROVIDER_URL;
  const apiKey = process.env.TRANSLATION_API_KEY;
  if (!url || !apiKey) return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "检测到泰文，但尚未配置翻译服务。请人工核对原文；不会自动改写订单字段。" };
  try {
    const result = await requestProvider(url, apiKey, { text, sourceLanguage: "th", targetLanguage: "zh-CN" });
    const value = typeof result.translatedText === "string" ? result.translatedText : "";
    if (!value) throw new Error("服务未返回 translatedText");
    return { status: "SUGGESTION_READY", provider: "已配置翻译服务", message: "已生成翻译建议，请人工复核后再填写订单。", value };
  } catch (error) {
    return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: `翻译服务暂不可用（${error instanceof Error ? error.message : "未知原因"}）。请人工核对原文。` };
  }
}

export async function identifyVehicleFromImage(imageUrl: string): Promise<ReviewAssistance> {
  if (!imageUrl.trim()) return { status: "NOT_NEEDED", provider: "人工复核", message: "未提供车辆图片。" };
  try { new URL(imageUrl); } catch { return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "车辆图片地址无效，请检查后重试。" }; }
  const url = process.env.VEHICLE_VISION_API_URL;
  const apiKey = process.env.VEHICLE_VISION_API_KEY;
  if (!url || !apiKey) return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: "已提供车辆图片，但尚未配置车型识别服务。请人工确认车型，不会自动替换订单车型。" };
  try {
    const result = await requestProvider(url, apiKey, { imageUrl });
    const value = typeof result.vehicleModel === "string" ? result.vehicleModel : "";
    if (!value) throw new Error("服务未返回 vehicleModel");
    return { status: "SUGGESTION_READY", provider: "已配置车型识别服务", message: "已生成车型建议，请人工复核后再确认。", value, confidence: typeof result.confidence === "number" ? result.confidence : undefined };
  } catch (error) {
    return { status: "MANUAL_REVIEW_REQUIRED", provider: "人工复核", message: `车型识别服务暂不可用（${error instanceof Error ? error.message : "未知原因"}）。请人工确认车型。` };
  }
}
